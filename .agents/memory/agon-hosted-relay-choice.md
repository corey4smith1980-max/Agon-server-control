---
name: Agon hosted relay choice
description: The selected relay architecture for the Agon control product on Replit.
---

Use Agon's own WebSocket relay for Replit-hosted devices. Do not claim native RustDesk relay compatibility: the hosted product uses a custom WebSocket protocol, while RustDesk requires a different native relay protocol and network exposure.

**Why:** The user selected the Replit-hosted Agon WSS option after learning that the RustDesk TCP/UDP relay path is not available on this hosting setup.

**How to apply:** Keep the agent and operator console on the documented Agon WSS contract, with device-generated credentials and explicit operator pairing approval. If the relay architecture changes, confirm the hosting and client compatibility constraints first.
