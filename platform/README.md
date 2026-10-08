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
| API server (`server/`) | Built; 14 automated tests pass against mock integrations |
| Document extraction | Mock (JSON fixtures) tested; Claude vision adapter written, tested with a stubbed network only |
| UAE PASS, Trustin, Ejari, title deed, clearance | Interfaces and mocks only. **No live adapters.** Real API access and schemas are unverified |
| Contract PDF | Field-complete draft layout, clearly marked as NOT the official form |
| Mobile app (`mobile/`) | Source written and typechecks; **never run on a device or simulator**, no store build |
| App Store / Google Play | Not started. Needs Apple Developer and Google Play accounts, privacy policy, review |

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
- [ ] Official form overlay replaces the draft layout in `server/src/contract/pdf.ts`
- [ ] Postgres repository and encrypted document storage in a UAE region
- [ ] Per-user authentication (UAE PASS login) replacing the shared pilot token
- [ ] Data protection review for the extraction provider and document retention
- [ ] Live adapters for each provider, tested in their sandboxes
- [ ] App built, tested on devices, privacy labels completed, submitted to both stores
