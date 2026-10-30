# Agon native agent builds

This archive contains the compiled Go agent for:

- Windows x64 and ARM64
- macOS Intel x64 and Apple silicon
- Linux x64 and ARM64
- Android ARM64 (MDM/ADB-managed executable, not an APK)

`manifest.json` records each platform, architecture, byte size, and SHA-256 digest. `SHA256SUMS` provides a standard checksum list.

These are unconfigured binaries. To enroll an endpoint, create a protected `agent.json` containing the relay URL and enrollment token, then run the matching binary with `-config agent.json`. Restrict that file to the operator/service account; it contains a credential. The console's Agent deployment page can instead create a configured installer package and local checksum receipt.

Service installation and removal require the explicit `-consent` flag and administrator approval. The agent supports enrollment, heartbeat, inventory refresh, ping, network diagnostics, and consent/policy status requests only; it does not execute arbitrary shell commands or provide remote desktop, screen capture, or input control.
