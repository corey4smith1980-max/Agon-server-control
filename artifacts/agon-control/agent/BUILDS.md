# Agon native agent builds

This archive contains the compiled Go agent for:

- Windows x64 and ARM64
- macOS Intel x64 and Apple silicon
- Linux x64 and ARM64
- Android ARM64 (MDM/ADB-managed executable, not an APK)

`manifest.json` records each platform, architecture, byte size, and SHA-256 digest. `SHA256SUMS` provides a standard checksum list.

These are unconfigured binaries. For the Replit-hosted relay, build a configured package from the signed-in console so it includes the correct relay URL and account ID. The endpoint creates its own credential on first setup; run the included installer and enter its printed pairing code in the console. The console's Agent deployment page creates the configured installer package and local checksum receipt.

Service installation and removal require the explicit `-consent` flag and administrator approval. The agent supports device pairing, heartbeat, inventory refresh, ping, network diagnostics, and consent/policy status requests only; it does not execute arbitrary shell commands or provide remote desktop, screen capture, or input control.
