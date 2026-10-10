import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { MockAuth, SessionStore } from "../src/auth.js";
import { EncryptedFileDocumentStore } from "../src/store/documents.js";
import { RateLimiter } from "../src/ratelimit.js";
import { TOKEN, auth, b64, call, fixture, makeApp, newConsentedContract, upload } from "./helpers.js";

const dir = mkdtempSync(join(tmpdir(), "dh-sec-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
const KEY = "ab".repeat(32);
const STAFF_EID = "784-1985-1111111-1";

describe("consent gate", () => {
  it("blocks documents and party data until consent is recorded, then audits it", async () => {
    const app = makeApp();
    const { body: c } = await call(app, "POST", "/contracts");
    expect((await upload(app, c.id, "title_deed", "title_deed")).status).toBe(409);
    expect((await call(app, "PATCH", `/contracts/${c.id}`, { tenant: { email: "a@b.test" } })).status).toBe(409);
    expect((await call(app, "PATCH", `/contracts/${c.id}`, { terms: { annualRent: "1" } })).status).toBe(200); // no personal data
    expect((await call(app, "POST", `/contracts/${c.id}/consent`, { noticeVersion: "" })).status).toBe(400);
    const ok = await call(app, "POST", `/contracts/${c.id}/consent`, { noticeVersion: "v1" });
    expect(ok.body.consent.noticeVersion).toBe("v1");
    expect((await upload(app, c.id, "title_deed", "title_deed")).status).toBe(201);
    const actions = (await call(app, "GET", `/contracts/${c.id}/audit`)).body.map((e: { action: string }) => e.action);
    expect(actions).toContain("consent.recorded");
  });
});

describe("encrypted document store", () => {
  it("round-trips, writes no plaintext, and binds content to its key", async () => {
    const store = new EncryptedFileDocumentStore(join(dir, "a"), KEY);
    const secret = Buffer.from("784-1985-1111111-1 PERSONAL DATA");
    await store.put("c1/d1", secret);
    expect((await store.get("c1/d1"))!.equals(secret)).toBe(true);
    expect(await store.get("c1/missing")).toBeUndefined();

    const files = readdirSync(join(dir, "a"));
    expect(files).toHaveLength(1);
    const raw = readFileSync(join(dir, "a", files[0]!));
    expect(raw.includes(Buffer.from("PERSONAL DATA"))).toBe(false);
  });

  it("detects tampering, key swaps and wrong keys", async () => {
    const store = new EncryptedFileDocumentStore(join(dir, "b"), KEY);
    await store.put("c1/d1", Buffer.from("one"));
    await store.put("c1/d2", Buffer.from("two"));
    const [f1, f2] = readdirSync(join(dir, "b")).map((f) => join(dir, "b", f));

    // swapping the ciphertext of two documents must fail for both (the storage key is authenticated data)
    const a = readFileSync(f1!);
    writeFileSync(f1!, readFileSync(f2!));
    writeFileSync(f2!, a);
    await expect(store.get("c1/d1")).rejects.toThrow(/integrity/);
    await expect(store.get("c1/d2")).rejects.toThrow(/integrity/);
    // flipping one byte fails
    const s2 = new EncryptedFileDocumentStore(join(dir, "c"), KEY);
    await s2.put("k", Buffer.from("hello"));
    const p = join(dir, "c", readdirSync(join(dir, "c"))[0]!);
    const buf = readFileSync(p);
    buf[buf.length - 1] = buf[buf.length - 1]! ^ 1;
    writeFileSync(p, buf);
    await expect(s2.get("k")).rejects.toThrow(/integrity/);
    // wrong key
    const other = new EncryptedFileDocumentStore(join(dir, "b"), "cd".repeat(32));
    await expect(other.get("c1/d1")).rejects.toThrow(/integrity/);
    expect(() => new EncryptedFileDocumentStore(join(dir, "d"), "short")).toThrow(/64 hex/);
  });

  it("stores uploads through the API and serves them back with an audit entry", async () => {
    const app = makeApp({}, { documents: new EncryptedFileDocumentStore(join(dir, "e"), KEY) });
    const id = await newConsentedContract(app);
    const up = await upload(app, id, "title_deed", "title_deed");
    const docId = up.body.document.id;
    const got = await app.inject({ method: "GET", url: `/contracts/${id}/documents/${docId}`, headers: auth });
    expect(got.statusCode).toBe(200);
    expect(got.rawPayload.equals(fixture("title_deed"))).toBe(true);
    expect(got.headers["cache-control"]).toBe("no-store");
    expect((await call(app, "GET", `/contracts/${id}/documents/nope`)).status).toBe(404);
    const actions = (await call(app, "GET", `/contracts/${id}/audit`)).body.map((e: { action: string }) => e.action);
    expect(actions).toContain("document.downloaded");
  });
});

describe("per-user login", () => {
  const withAuth = (staff = [STAFF_EID], sessions?: SessionStore) =>
    makeApp({}, { auth: { provider: new MockAuth(), staffEmiratesIds: staff, sessions } });

  async function login(app: ReturnType<typeof withAuth>, eid: string) {
    const start = await app.inject({ method: "POST", url: "/auth/login/start", payload: { emiratesId: eid } });
    const state = start.json().state;
    return app.inject({ method: "POST", url: "/auth/login/complete", payload: { state } });
  }

  it("issues a session for allow-listed staff, records them as the actor, and refuses everyone else", async () => {
    const app = withAuth();
    const ok = await login(app, STAFF_EID);
    expect(ok.statusCode).toBe(200);
    const sessionToken = ok.json().sessionToken as string;

    const created = await app.inject({ method: "POST", url: "/contracts", headers: { authorization: `Bearer ${sessionToken}` } });
    expect(created.statusCode).toBe(201);
    const audit = await app.inject({ method: "GET", url: `/contracts/${created.json().id}/audit`, headers: { authorization: `Bearer ${sessionToken}` } });
    expect(audit.json()[0].actor).toBe(`uaepass:${STAFF_EID}`);

    const stranger = await login(app, "784-1990-2222222-2");
    expect(stranger.statusCode).toBe(403);
    expect(stranger.json().sessionToken).toBeUndefined();
  });

  it("denies all logins when the allow-list is empty, and never reuses a login state", async () => {
    const none = withAuth([]);
    expect((await login(none, STAFF_EID)).statusCode).toBe(403);

    const app = withAuth();
    const start = await app.inject({ method: "POST", url: "/auth/login/start", payload: { emiratesId: STAFF_EID } });
    const state = start.json().state;
    expect((await app.inject({ method: "POST", url: "/auth/login/complete", payload: { state } })).statusCode).toBe(200);
    expect((await app.inject({ method: "POST", url: "/auth/login/complete", payload: { state } })).statusCode).toBe(401);
  });

  it("is off by default and rejects unknown or expired sessions", async () => {
    const off = makeApp();
    expect((await off.inject({ method: "POST", url: "/auth/login/start", payload: {} })).statusCode).toBe(404);
    expect((await off.inject({ method: "POST", url: "/contracts", headers: { authorization: "Bearer not-a-session" } })).statusCode).toBe(401);

    let now = 1_000;
    const sessions = new SessionStore(1000, () => now);
    const token = sessions.create({ userId: "u", name: "n", emiratesId: STAFF_EID });
    expect(sessions.resolve(token)?.userId).toBe("u");
    now += 1001;
    expect(sessions.resolve(token)).toBeUndefined();
  });

  it("still accepts the operator token", async () => {
    const app = withAuth();
    expect((await app.inject({ method: "POST", url: "/contracts", headers: { authorization: `Bearer ${TOKEN}` } })).statusCode).toBe(201);
  });
});

describe("rate limiting", () => {
  it("limits login attempts and general traffic per client", async () => {
    const app = makeApp({}, { auth: { provider: new MockAuth(), staffEmiratesIds: [] }, rateLimit: { general: 5, login: 3 } });
    const codes: number[] = [];
    for (let i = 0; i < 5; i++) codes.push((await app.inject({ method: "POST", url: "/auth/login/start", payload: { emiratesId: STAFF_EID } })).statusCode);
    expect(codes).toEqual([200, 200, 200, 429, 429]);

    const codes2: number[] = [];
    for (let i = 0; i < 7; i++) codes2.push((await app.inject({ method: "GET", url: "/integrations", headers: auth })).statusCode);
    expect(codes2).toEqual([200, 200, 200, 200, 200, 429, 429]);
    void b64;
  });

  it("starts a fresh window after the interval", () => {
    let t = 0;
    const l = new RateLimiter(1000, () => t);
    expect([l.allow("k", 1), l.allow("k", 1)]).toEqual([true, false]);
    t = 1000;
    expect(l.allow("k", 1)).toBe(true);
  });
});
