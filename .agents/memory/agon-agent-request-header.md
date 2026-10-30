---
name: Hosted native agent pairing headers
description: Hosted pairing requests need the native marker plus same-origin referrer headers.
---

Hosted native agent pairing requests must include `X-Requested-With: XMLHttpRequest`, `Origin` matching the configured API origin, and `Referer` set to that origin plus `/deployment`. The published API accepts both `/api/agon` and the deployment-prefixed alias `/deployment/api/agon`; the alias is explicitly routed to the API service, not the SPA. Keep the operator console and agent on the same published environment so pairing approvals share records. Standalone relay requests should omit browser-origin headers.

**Why:** Existing installers or operator instructions may require the deployment-prefixed API URL, while an unconfigured SPA fallback returns HTML instead of control-plane responses.

**How to apply:** Route both API prefixes and their WebSocket paths to the API service, send the published console route as the Referer, and test the requested path with an invalid body (it should reach API validation, not return HTML). Regenerate downloadable agent installers after client changes. Already-running binaries do not update automatically.
