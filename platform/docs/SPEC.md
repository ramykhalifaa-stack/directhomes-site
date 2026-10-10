# Direct Homes Tenancy Platform: Design Spec (Pilot, Phase 1)

Status: draft written under delegated authority ("take control and do it"). Review before production use.

## 1. Purpose

Let Direct Homes execute real pilot tenancy contracts between a landlord and a tenant, from a phone, by:

1. collecting landlord, tenant and property data,
2. extracting that data from a title deed, Emirates ID and trade license (OCR, meaning optical character recognition, which reads text from images),
3. checking the property is clear (title deed valid, no rental dispute, no overdue service charges),
4. producing the tenancy contract in the Dubai unified tenancy contract format,
5. signing with UAE PASS (the UAE national digital identity),
6. optionally holding the deposit in escrow (Trustin),
7. registering the contract with Ejari (Dubai's tenancy registration system run through the Dubai Land Department, DLD).

## 2. Scope and assumptions

| Item | Decision | Status |
|---|---|---|
| Emirate | Dubai only (Ejari, RERA unified contract) | Confirmed by Direct Homes |
| Platforms | iOS and Android from one Expo/React Native codebase | Recommendation |
| Backend | TypeScript, Fastify, Zod validation; SQLite on one node for the pilot, Postgres later | Recommendation |
| Integrations | Interfaces plus mock adapters now; live adapters after partner onboarding | Required, APIs unverified |
| Official form | Generated draft layout now; `contract/overlay.ts` stamps data onto the official PDF using a field map (config, not code) once legal supplies the form | Required |

Out of scope for Phase 1 and by decision: other emirates (for example Abu Dhabi Tawtheeq), power of attorney flows, rent renewals, payments processing beyond escrow, commercial leases.

## 3. What is verified and what is not

Verified in this repo: the code in `platform/server` and its automated tests, running against mock integrations.

Not verified (do not assume):

- That Trustin, DLD/Ejari, title deed verification or clearance checks expose APIs available to Direct Homes. These normally need partner or licensed-broker onboarding. The request and response shapes in `integrations/types.ts` are our own design, not the providers' real schemas. They must be mapped when real API documentation is received.
- The exact field list and wording of the current official Dubai tenancy contract. `contract/fields.ts` reflects our understanding and must be checked against the current official form.
- Legal validity of an electronic signature flow, Ejari registration eligibility for a non-broker, and any licensing Direct Homes needs to operate. Legal counsel must confirm.
- The mobile app: source is written but has not been built or run in this environment.

## 4. Architecture

```
Expo app (iOS/Android)  --HTTPS-->  API server  --> Repository (memory now, Postgres later)
                                       |--> Extractor    (mock | Claude vision)
                                       |--> Identity     (mock | UAE PASS)
                                       |--> TitleDeed    (mock | live)
                                       |--> Clearance    (mock | live)
                                       |--> Escrow       (mock | Trustin)
                                       |--> Ejari        (mock | DLD Ejari)
                                       |--> PDF generator
                                       '--> Audit log
```

Each external provider sits behind one interface. Mode per provider is set by environment variable (`mock` or `live`). A `live` provider with no adapter fails loudly with `NotConfiguredError`; it never silently falls back to a mock.

## 5. Contract lifecycle

`draft` -> `verified` -> `signing` -> `signed` -> `registered`

- `draft`: data being collected. Every extracted field is marked unconfirmed until a person confirms it.
- `verified`: all required fields present and confirmed, party names match the title deed owner, Emirates IDs and licenses not expired, title deed valid, clearance passed. Any edit returns the contract to `draft`.
- `signing`: contract content frozen and hashed (SHA-256, a fingerprint of the content); each party signs through the identity provider.
- `signed`: both parties signed.
- `registered`: Ejari number issued. If escrow is requested, the deposit must be funded first.

## 6. Data protection

Documents contain Emirates ID numbers and property data, which are personal data. Points to settle before real data is used:

- Sending images to a third-party AI service (the Claude extractor) is a cross-border transfer; confirm consent, residency and contractual terms under UAE federal data protection law (Federal Decree-Law No. 45 of 2021, to be confirmed by counsel).
- Host production storage in a UAE region; encrypt documents at rest; retention policy.
- This public repository must never receive real documents, keys or customer data. See README.

## 6a. Security controls in the pilot code

| Control | What it does | Limit |
|---|---|---|
| Consent gate | No documents or landlord/tenant data can be entered until a consent record (who, when, notice version) exists; edits are audited | Records that staff attest consent; the notice wording must come from counsel |
| Encrypted documents | Originals stored with AES-256-GCM; the storage key is authenticated data so files cannot be swapped between contracts; tampering is detected | Key lives in an environment variable on one host; production needs a UAE-region store and managed keys |
| Per-user login | Opaque 8-hour sessions (only hashes held), allow-list of staff Emirates IDs, deny by default, the person is the audit actor | Only a mock provider exists; mock must never face the internet |
| Rate limiting | Per-client limits, tighter on login | In memory, single instance |
| Signed PDF links | 5-minute HMAC links so the phone can open a PDF without the API token | Anyone holding the link can open it for 5 minutes |

## 7. Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Provider APIs unavailable to Direct Homes | Core steps become manual | Adapter design lets each step fall back to a manual upload and staff attestation |
| OCR error on a legal field | Wrong contract | Confidence scores, mandatory human confirmation, cross-checks (owner vs landlord) |
| Template drift | Invalid form | Pin form version, legal review on change |
| Code in a public repo | Data or key leak | Move to a private repo before live keys; secret scanning |

## 8. Success criteria for the pilot

- A contract is created from documents to a signed PDF in one session without retyping fields.
- 100% of fields reach a human confirmation before verification.
- Every state change is in the audit log.
- Switching one provider from mock to live requires no change outside its adapter and environment config.
