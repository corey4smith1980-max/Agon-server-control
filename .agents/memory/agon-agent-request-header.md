---
name: Hosted native agent pairing headers
description: Hosted pairing requests need the native marker plus same-origin referrer headers.
---

Hosted native agent pairing requests must include `X-Requested-With: XMLHttpRequest`, `Origin` matching the configured API origin, and `Referer` set to that origin plus `/deployment`. The console page route `/deployment` is not an API prefix: the published API base is `/api/agon`, not `/deployment/api/agon`. Keep the operator console and agent on the same published environment so pairing approvals share records. Standalone relay requests should omit browser-origin headers.

**Why:** Agents built from the preview can target a different API/database than the published console, and prefixing `/deployment` onto the API path serves the SPA rather than the control-plane API.

**How to apply:** Use the production API base when building laptop installers, send the published console route as the Referer, test the actual API path with an invalid body (it should reach API validation, not return an auth/edge error), and regenerate downloadable agent binaries after client changes. Already-running binaries do not update automatically.
