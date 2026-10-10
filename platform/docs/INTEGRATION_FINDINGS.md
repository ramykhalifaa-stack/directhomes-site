# Integration research (10 Oct 2026)

Method: web searches, using the pages' own wording as returned by the search tool. The build environment cannot open the government sites directly, so none of these pages were read in full here. Pages may have changed; re-check each live page before relying on a fee or a requirement.

| Service | Finding | Source |
|---|---|---|
| Ejari API | DLD's API page says a software provider needs IT activities on its trade licence, a Dubai office, and an association with a real estate management company registered in Ejari. Listed price: AED 30,000 + 5% VAT per year (page is dated). | https://dubailand.gov.ae/en/eservices/api-gateway-registration?appId=2 |
| Title deed verification | Offered to people through the DLD website and the Dubai REST app. No developer programme or API found. | https://www.dubailand.gov.ae/en/eservices/title-deed-verification-overview |
| Service charge clearance | Only a Mollak "Budget Sync" API for banks registered in Mollak. No clearance API found. No public source found for rental dispute status. | https://dubailand.gov.ae/en/eservices/api-gateway-registration?appId=5 |
| UAE PASS | Four phases (initiation, development, assessment, go-live). Private entities need a valid UAE trade licence, per-feature questionnaires, a workflow diagram and wireframes; staging credentials follow approval. No fee or timeline found. | https://docs.uaepass.ae/getting-onboarded-with-uae-pass/onboarding-process-for-uae-pass-service-providers/initiation-phase |
| Trustin | Digital escrow with an ADGM financial services permission. Tenancy deposits not confirmed; ask Trustin directly. | https://www.adgm.com/media/announcements/trustin-secures-key-adgm-fsp-licence |
| Manual Ejari | Dubai REST app or a real estate service trustee centre; certificate reported in 1 to 2 working days; fees vary by source (about AED 155 to 220). | https://www.bayut.com/mybayut/how-to-register-ejari-complete-guide |
| Apple / Google | Both need a D-U-N-S number for organisations. Apple: up to 5 business days for the number. Google: verification can take up to 30 days. | https://developer.apple.com/support/D-U-N-S/ , https://support.google.com/googleplay/android-developer/answer/10841920 |

## Consequence for the design

The interfaces in `server/src/integrations/types.ts` assumed an API for every provider. For title deed, clearance and (probably) Ejari there is none available to Direct Homes, so those steps need a manual "assisted mode": staff do the check or registration through the official channel and record the result with evidence. Escrow and signing can stay API-based once approvals exist. See the decision recorded in the launch pack.
