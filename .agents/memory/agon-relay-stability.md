---
name: Agon relay stability
description: Preserve bounded reconnect behavior, WebSocket liveness checks, and recovery for commands interrupted by disconnects.
---

Keep the Go agent's exponential backoff active until a WebSocket has remained stable for a meaningful interval. Use server ping/pong checks to detect half-open connections, and requeue stale running jobs after reconnect so a dropped socket does not leave work stuck indefinitely.

**Why:** Resetting retry delay immediately after enrollment creates rapid reconnect loops when the WebSocket keeps failing; half-open sockets can also leave devices marked online and commands stuck.

**How to apply:** Maintain bounded jittered retries, a ping timeout shorter than the client read timeout, and delayed at-least-once recovery for allowlisted jobs. If future commands are not idempotent, add command deduplication before replaying them.
