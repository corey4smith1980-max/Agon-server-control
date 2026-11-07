# Agon native agent builds

This archive contains the compiled Go agent for:

- Windows x64 and ARM64
- macOS Intel x64 and Apple silicon
- Linux x64 and ARM64
- Android ABI-independent APK for Android 8.0+ (API 26+), targeting Android 17 (API 37)

`manifest.json` records each platform, architecture, byte size, and SHA-256 digest. `SHA256SUMS` provides a standard checksum list.

Native binaries are unconfigured. The universal Android APK includes the published Agon relay URL but asks for an organization ID at first launch; it generates device credentials locally and displays a pairing code for operator approval. The APK is debug-signed for internal sideload testing. Configure an organization-owned stable signing key before broad rollout.

Service installation and removal require the explicit `-consent` flag and administrator approval. The agent supports device pairing, heartbeat, inventory refresh, ping, network diagnostics, and consent/policy status requests only; it does not execute arbitrary shell commands or provide remote desktop, screen capture, or input control.
