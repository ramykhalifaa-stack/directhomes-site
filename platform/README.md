# Direct Homes tenancy platform (pilot scaffold)

Issues Dubai tenancy contracts from a phone: scan documents, review the extracted data,
verify the property, sign with UAE PASS, hold the deposit in escrow, register with Ejari.

> **This folder does not belong in a public repository long term.** It lives here only because
> this was the designated working branch. It contains no real data and no keys. Move it to a
> private repository before any live credentials, real documents or customer data are used.
> The published site (`docs/`) is unaffected: GitHub Pages serves only `docs/`.

Design and open questions: [`docs/SPEC.md`](docs/SPEC.md).

## Status (be precise about what works)

| Part | State |
|---|---|
| API server (`server/`) | Built; 29 automated tests pass against mock integrations. Optional durable SQLite storage (`DATABASE_FILE`), AES-256-GCM encrypted original-document storage (`DOCUMENT_DIR`), per-user login with a staff allow-list, recorded data-processing consent, rate limiting, official-form overlay (`OFFICIAL_TEMPLATE_PDF`, `OFFICIAL_TEMPLATE_MAP`) |
| Document extraction | Mock (JSON fixtures) tested; Claude vision adapter written, tested with a stubbed network only |
| UAE PASS, Trustin, Ejari, title deed, clearance | Interfaces and mocks only. **No live adapters.** Real API access and schemas are unverified |
| Contract PDF | Field-complete draft layout, clearly marked as NOT the official form |
| Mobile app (`mobile/`) | Source written and typechecks; **never run on a device or simulator**, no store build |
| App Store / Google Play | Build config (`mobile/eas.json`) and a step-by-step guide in [`docs/RELEASE.md`](docs/RELEASE.md). Not executed: needs your Apple and Google organisation accounts |
| Docker image (`server/Dockerfile`) | Written, not built in this environment |

## Run the server

```bash
cd server
npm install
PILOT_API_TOKEN=$(openssl rand -hex 24) npm start     # mocks for every integration
npm test
```

Environment variables:

| Variable | Values | Meaning |
|---|---|---|
| `PILOT_API_TOKEN` | required | Bearer token for the pilot API |
| `EXTRACTOR` | `mock` (default), `claude` | `claude` needs `ANTHROPIC_API_KEY`; sends documents to a third party |
| `DOCUMENT_DIR`, `DOCUMENT_KEY` | optional pair | Store original documents encrypted on disk; key is 64 hex characters from a secret manager. Without them documents are held in memory and lost on restart |
| `AUTH_MODE`, `STAFF_EMIRATES_IDS` | `disabled` (default) / `mock` / `live`; comma list | Per-user login. `mock` trusts any claimed Emirates ID, so use it only on a machine nobody else can reach. `live` (UAE PASS) is not implemented. Only listed identities get a session. `PILOT_API_TOKEN` remains as a break-glass operator credential |
| `DATABASE_FILE` | path, optional | Persist data in SQLite; without it data is lost on restart |
| `OFFICIAL_TEMPLATE_PDF`, `OFFICIAL_TEMPLATE_MAP` | paths, optional | Stamp data onto the official form using a JSON field map |
| `IDENTITY_MODE`, `TITLE_DEED_MODE`, `CLEARANCE_MODE`, `ESCROW_MODE`, `EJARI_MODE` | `mock` (default), `live` | `live` fails at startup until a live adapter exists |

Mock triggers for demos: title deed number starting `BAD` fails verification; property number
ending `99` has overdue service charges; ending `98` has a rental dispute.

## Run the app

```bash
cd mobile
npm install
npx expo install --fix     # align package versions with the installed Expo SDK
npx expo start
```

The app needs a camera for scanning, so use a real phone (Expo Go or a dev build).
Against the mock extractor, scans will fail by design (it only reads JSON fixtures); use
`EXTRACTOR=claude` with a test document, or post fixtures from `server/fixtures/` via the API.

## Adding a real integration

1. Obtain partner credentials and API documentation from the provider.
2. Implement the matching interface from `server/src/integrations/types.ts` in
   `server/src/integrations/live/<provider>.ts`, mapping the provider's schema onto ours.
3. Return it from `registry.ts` when its `*_MODE` is `live`.
4. Add contract tests against the provider's sandbox.

## Before the first real contract (checklist)

- [ ] Private repository; secret scanning on
- [ ] Legal sign-off: official unified contract form, e-signature validity, Direct Homes' authority to register with Ejari
- [ ] Official form PDF and its field map supplied (see `server/src/contract/overlay.ts`), then verify every field position on a real printout
- [ ] Move document storage to a UAE-region object store with managed keys (the pilot encrypts on local disk); Postgres and a shared rate-limit store if more than one instance is needed
- [ ] Legal-approved data-processing notice text (the app records a notice version string; the text itself is not written)
- [ ] Live UAE PASS login adapter (the session, allow-list and audit-by-person plumbing already exists); then retire the shared `PILOT_API_TOKEN` or lock it away
- [ ] Data protection review for the extraction provider and document retention
- [ ] Live adapters for each provider, tested in their sandboxes
- [ ] App built, tested on devices, privacy labels completed, submitted to both stores
