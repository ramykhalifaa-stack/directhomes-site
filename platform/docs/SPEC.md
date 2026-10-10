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
| Official form | The supplied official PDF is stamped unmodified (`templates/`), using a coordinate map that is configuration, not code; values that do not fit or are not Latin text fail loudly instead of being truncated | Done; legal to confirm version |

Out of scope for Phase 1 and by decision: other emirates (for example Abu Dhabi Tawtheeq), power of attorney flows, rent renewals, payments processing beyond escrow, commercial leases.

## 3. What is verified and what is not

Verified in this repo: the code in `platform/server` and its automated tests, running against mock integrations.

Not verified (do not assume):

- That Trustin, DLD/Ejari, title deed verification or clearance checks expose APIs available to Direct Homes. These normally need partner or licensed-broker onboarding. The request and response shapes in `integrations/types.ts` are our own design, not the providers' real schemas. They must be mapped when real API documentation is received.
- That the supplied form is the current official version. The field list was taken from the form Direct Homes supplied (Dubai Land Department / Ejari unified tenancy contract, 3 pages, SHA-256 `33802759...3925`); legal must confirm it is current.
- Legal validity of an electronic signature flow, Ejari registration eligibility for a non-broker, and any licensing Direct Homes needs to operate. Legal counsel must confirm.
- The mobile app: source is written but has not been built or run in this environment.
- Printing: checked on screen at 100 to 140 dpi, not on paper, and not by a native Arabic reader. Arabic is drawn as vector outlines from the bundled Noto Sans Arabic font (SIL OFL, `templates/fonts/OFL.txt`), so it is not searchable in the PDF. Bidirectional ordering is done at word level, which is right for names, addresses and company names but is not a full Unicode bidi implementation. The "Additional Terms" lines on page 3 are left blank.

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

## 5a. Assisted mode

For steps with no usable API (title deed check, clearance, Ejari registration) or no approval yet (UAE PASS, Trustin), staff perform the step through the official channel and record the result. Rules enforced by the server:

- every record needs at least one photo or scan (evidence), stored encrypted and hashed;
- title deed and clearance records are tied to the property details (title deed number, owner, plot, property number, building): changing any of them makes the records stale and verification refuses them;
- a paper signature can only be recorded after signing started (which freezes the contract hash), with the date written on the copy (not in the future);
- a deposit record is required before Ejari when the contract uses a deposit hold; an Ejari record needs a plausible number, a channel and a date;
- a manual record is refused where that step is automatic, and the API route is refused where the step is manual, so the two can never be mixed up;
- deployed servers (`NODE_ENV=production`) default to manual and refuse mock providers unless explicitly allowed, so a fake registration number cannot be produced by a missing setting.

What this does not prove: that the staff member really performed the check. It records who said so, when, with what evidence. Whether this is acceptable, including paper signing, is for counsel to confirm.

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
| Provider APIs unavailable to Direct Homes | Research (see INTEGRATION_FINDINGS.md) found no public API for title deed verification or clearance, and the Ejari API has strict prerequisites. Those steps are manual | Add an assisted mode where staff perform the official check or registration and record the result with evidence; keep adapters for providers that do offer APIs |
| OCR error on a legal field | Wrong contract | Confidence scores, mandatory human confirmation, cross-checks (owner vs landlord) |
| Template drift | Invalid form | Pin form version, legal review on change |
| Code in a public repo | Data or key leak | Move to a private repo before live keys; secret scanning |

## 8. Success criteria for the pilot

- A contract is created from documents to a signed PDF in one session without retyping fields.
- 100% of fields reach a human confirmation before verification.
- Every state change is in the audit log.
- Switching one provider from mock to live requires no change outside its adapter and environment config.
