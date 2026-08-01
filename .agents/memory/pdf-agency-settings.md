---
name: PDF exports use agency settings
description: Both PDF generators must read agency name/contact from agencySettings parameter, never hardcode
---

**Rule:** `generateQuotationPdf` and `generateOperationPdf` both accept `agencySettings: AgencySettings | null` as a parameter. They fall back to "TourOps Acentesi" if null. Never hardcode agency names or contact details in PDF files.

**Why:** The original quotation PDF hardcoded "Iglesias Tour Turkey" which was wrong for any other agency using the system.

**How to apply:** Any future PDF generator must accept AgencySettings parameter. Callers fetch with `useGetAgencySettings()` hook (operationId: getAgencySettings, path: GET /agency-settings).
