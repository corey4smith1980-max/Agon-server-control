---
name: Agon relay stability
description: Preserve bounded reconnect behavior, WebSocket liveness checks, and recovery for commands interrupted by disconnects.
---

Keep the Go agent's exponential backoff active until a WebSocket has remained stable for a meaningful interval. Use server ping/pong checks to detect half-open connections, and requeue stale running jobs after reconnect so a dropped socket does not leave work stuck indefinitely. On the server, reserve protocol close codes for malformed/unsupported frames; log processing or database failures separately and allow later heartbeats to retry transient work.

**Why:** Resetting retry delay immediately after enrollment creates rapid reconnect loops when the WebSocket keeps failing; half-open sockets can also leave devices marked online and commands stuck. Labeling a backend exception as an invalid agent frame obscures the root cause and causes avoidable reconnects.

**How to apply:** Maintain bounded jittered retries, a ping timeout shorter than the client read timeout, and delayed at-least-once recovery for allowlisted jobs. Log sanitized connection identifiers and structured failure causes without logging credentials or full message payloads. If future commands are not idempotent, add command deduplication before replaying them.
