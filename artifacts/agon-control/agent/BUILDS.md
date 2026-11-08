# Agon native agent builds — Enterprise Background Edition

All agents install and run as **silent system background processes**. No interactive windows, consent dialogs, or companion pop-ups after installation.

Supported platforms:
- Windows x64 and ARM64 (LocalSystem service)
- macOS Intel x64 and Apple silicon
- Linux x64 and ARM64
- Android (APK / MDM)

## Silent installers

Generated in `installers/`:
- `install-windows.bat` — silent LocalSystem service
- `install-linux.sh`
- `install-macos.sh`

Usage (example):
```
install-windows.bat
# or
sudo ./install-linux.sh
```

No user interaction required after launch. The agent starts immediately as a background service.

## Custom installers

Windows x64 custom builds are MSI packages, the same shape as a ScreenConnect access installer:

- Per-machine, silent (`msiexec /i Agon.msi /qn`)
- `AgonAgent` LocalSystem service, no window after install
- Organization, group, relay, and session mode baked into `agent.json`
- Stable upgrade code so a newer MSI replaces the installed agent
- Optional desktop companion is a separate feature and is not installed

Each custom Android APK gets its own random signing key (APK Signature Scheme v1, v2, and v3). The alias, certificate SHA-256, and both passwords are stored on that device in the admin dashboard. The private keystore stays on the server under `data/signing-keys/` and is not committed.

From a device record, **Send installer upgrade** queues `agent.upgrade` for Windows, macOS, Linux, or Android. The agent applies the package as a silent background install.


Full remote support actions are accepted (allowlist removed). Desktop, file, shell, and other tools run under the system service context.
