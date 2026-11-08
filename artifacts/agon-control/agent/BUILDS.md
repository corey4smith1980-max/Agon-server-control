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

## Capabilities

Full remote support actions are accepted (allowlist removed). Desktop, file, shell, and other tools run under the system service context.
