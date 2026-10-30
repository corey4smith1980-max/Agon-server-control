---
name: Hosted native agent pairing headers
description: Hosted pairing requests need the native marker plus same-origin referrer headers.
---

Hosted native agent pairing requests must include `X-Requested-With: XMLHttpRequest` and matching `Origin` and `Referer` headers. Without them, the hosted request guard can reject the call before the application route runs. Standalone relay requests should omit browser-origin headers.

**Why:** Native requests were rejected by the hosted edge for a missing request marker and then an invalid referrer.

**How to apply:** Derive matching origin headers from the configured hosted relay URL, test the outgoing HTTP and WebSocket requests, and regenerate downloadable agent binaries after client changes. Already-running binaries do not update automatically.
