---
name: Hosted agent enrollment request header
description: The hosted request guard requires a request marker on the Go agent's enrollment POST.
---

Agent enrollment POSTs must include `X-Requested-With: XMLHttpRequest`; without it, the hosted request guard can reject enrollment with 403 before the application route runs.

**Why:** Enrollment is a public, one-time-token flow for native clients, but the hosted request guard still checks this header.

**How to apply:** Keep the header in the Go enrollment client, test that the outgoing request contains it, and regenerate downloadable agent binaries after changing client code. Already-running binaries do not update automatically.
