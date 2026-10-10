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
| API server (`server/`) | Built; 66 automated tests pass against mock integrations. Optional durable SQLite storage (`DATABASE_FILE`), AES-256-GCM encrypted original-document storage (`DOCUMENT_DIR`), per-user login with a staff allow-list, recorded data-processing consent, rate limiting, official-form stamping |
| Document extraction | Mock (JSON fixtures) tested; Claude vision adapter written, tested with a stubbed network only |
| UAE PASS, Trustin, Ejari, title deed, clearance | **Assisted mode built (staff do each step through the official channel and record it with evidence).** No live API adapters: access is unverified or unavailable, see `docs/INTEGRATION_FINDINGS.md` |
| Contract PDF | **Stamped onto the official Dubai Land Department / Ejari unified tenancy contract** (3-page form you supplied, bundled unmodified in `server/templates/`), with e-signature evidence in the signature boxes. Latin text only; Arabic values, the page 3 "Additional Terms" lines and legal sign-off on the form version are still open. `TEMPLATE_MODE=draft` gives the old draft layout |
| Mobile app (`mobile/`) | Source written and typechecks; **never run on a device or simulator**, no store build |
| App Store / Google Play | Build config (`mobile/eas.json`) and a step-by-step guide in [`docs/RELEASE.md`](docs/RELEASE.md). Not executed: needs your Apple and Google organisation accounts |
| Docker image (`server/Dockerfile`) | Written, not built in this environment |

## Run the server

```bash
cd server
npm install
PILOT_API_TOKEN=$(openssl rand -hex 24) npm start     # mocks for every integration
npm test
npx tsx scripts/sample.ts out.pdf   # renders a sample contract (fictitious data) on the official form
```

Environment variables:

| Variable | Values | Meaning |
|---|---|---|
| `PILOT_API_TOKEN` | required | Bearer token for the pilot API |
| `EXTRACTOR` | `manual`, `mock`, `claude` | `manual` stores the document and reads nothing (staff type the values; nothing leaves the server). `claude` needs `ANTHROPIC_API_KEY` and sends documents to a third party, so enable it only after counsel approves. Default: `mock`, but `manual` when `NODE_ENV=production` |
| `DOCUMENT_DIR`, `DOCUMENT_KEY` | optional pair | Store original documents encrypted on disk; key is 64 hex characters from a secret manager. Without them documents are held in memory and lost on restart |
| `AUTH_MODE`, `STAFF_EMIRATES_IDS` | `disabled` (default) / `mock` / `live`; comma list | Per-user login. `mock` trusts any claimed Emirates ID, so use it only on a machine nobody else can reach. `live` (UAE PASS) is not implemented. Only listed identities get a session. `PILOT_API_TOKEN` remains as a break-glass operator credential |
| `DATABASE_FILE` | path, optional | Persist data in SQLite; without it data is lost on restart |
| `TEMPLATE_MODE`, `OFFICIAL_TEMPLATE_PDF`, `OFFICIAL_TEMPLATE_MAP` | optional | Official form is used by default. `draft` switches to the generated layout; the two paths point to a revised form and its coordinate map |
| `IDENTITY_MODE`, `TITLE_DEED_MODE`, `CLEARANCE_MODE`, `ESCROW_MODE`, `EJARI_MODE` | `manual`, `mock`, `live` | `manual` = assisted mode (staff record the result). `mock` = fakes for development. `live` fails at startup until a live adapter exists. Default: `mock`, but `manual` when `NODE_ENV=production` |
| `ALLOW_MOCK_INTEGRATIONS` | `1` | Only for demos: allows mocks when `NODE_ENV=production` (otherwise refused) |

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

## Assisted mode runbook (pilot)

The Docker image runs with `NODE_ENV=production`, so every step is assisted by default. For each contract, staff:

1. **Start a contract** and record consent (both parties have seen the data-processing notice).
2. **Scan** the Emirates IDs and title deed (stored encrypted), then **type the values** while reading the documents, and confirm them.
3. **Title deed check:** verify the deed in the Dubai REST app or on the DLD website, photograph the result, record it (valid or problem).
4. **Clearance check:** obtain proof that there are no unpaid service charges or open rental disputes (for example a management company statement), photograph it, record it.
5. **Verify** in the app. This passes only if both records exist, belong to the current property details, and the data checks pass.
6. **Print** the official contract (it is generated from the confirmed data), have both parties sign, **record each signed copy** with a photo and the date written on it. The contract is frozen from the moment signing starts.
7. **Deposit** (if used): record how it was paid, the reference and amount, with a photo of the receipt.
8. **Ejari:** register in the Dubai REST app or at a trustee centre, then record the Ejari number, channel and date with a photo of the certificate.

Every step is audited with the person who did it and the SHA-256 of each photo. Editing the property details after a check makes that check stale, and the app asks for it again.

## Adding a real integration

0. A step can switch from manual to automatic one provider at a time (set that provider's `*_MODE`); the attestation routes then close and the API routes open.
1. Obtain partner credentials and API documentation from the provider.
2. Implement the matching interface from `server/src/integrations/types.ts` in
   `server/src/integrations/live/<provider>.ts`, mapping the provider's schema onto ours.
3. Return it from `registry.ts` when its `*_MODE` is `live`.
4. Add contract tests against the provider's sandbox.

## Before the first real contract (checklist)

- [ ] Private repository; secret scanning on
- [ ] Legal sign-off: official unified contract form, e-signature validity, Direct Homes' authority to register with Ejari
- [x] Official form and its coordinate map supplied and checked visually on all 3 pages (`server/templates/`). Still to do: legal confirms this is the current form, and a printout test on paper
- [x] Arabic names and Arabic/Latin mixed values print correctly (checked visually); other scripts are rejected with a clear error. Remaining: a native Arabic reader should review a printed sample
- [ ] Move document storage to a UAE-region object store with managed keys (the pilot encrypts on local disk); Postgres and a shared rate-limit store if more than one instance is needed
- [ ] Legal-approved data-processing notice text (the app records a notice version string; the text itself is not written)
- [ ] Live UAE PASS login adapter (the session, allow-list and audit-by-person plumbing already exists); then retire the shared `PILOT_API_TOKEN` or lock it away
- [ ] Data protection review for the extraction provider and document retention
- [ ] Live adapters for each provider, tested in their sandboxes
- [ ] App built, tested on devices, privacy labels completed, submitted to both stores
