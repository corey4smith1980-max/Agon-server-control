# Agon endpoint agent

Version 1.0.4 — consent-based endpoint inventory, diagnostics, and Windows interactive desktop support.

## What the agent does

The service agent makes an outbound TLS WebSocket connection to the relay URL in `agent.json`. On first setup it creates a stable device ID and a random device credential locally, then prints a pairing code. The credential remains inactive until an operator enters that code in the console. Inventory includes OS version, processor model and core count, memory and system-disk usage, and active non-loopback IP addresses where the platform exposes them.

On Windows, the installer also starts a separate, visible desktop companion in the signed-in user's session and configures it to start visibly at future sign-ins. The companion opens a local consent dialog for every interactive session. Only after approval does it stream a bounded desktop view and accept allowlisted pointer and keyboard events. Closing the companion disconnects it. Secure sign-in and UAC desktops are not shared. Other platforms currently remain inventory/diagnostics only.

## Interactive run

```sh
./agon-agent -config agent.json
```

Stop with Ctrl+C. The endpoint must use HTTPS/WSS except for localhost development. For a new device, run `./agon-agent -config agent.json -pair`, then enter the printed pairing code in the signed-in console.

## Service installation

Use the generated package from the console. Windows packages are MSI files with the service, organization config, a visible desktop companion shortcut, and standard uninstall registration. Launch the companion from Start after installation to display the device pairing code. Service installation requires administrator approval.

- Windows: `install.ps1` registers a real Windows service named `AgonAgent` and adds the visible user-session companion to the current user's startup.
- Linux: `install.sh` installs a hardened systemd unit running as the `agonagent` system user.
- macOS: `install.sh` installs a LaunchDaemon visible as `com.agon.agent`.
- Android: install the ABI-independent APK on Android 8.0+ (API 26+) devices; it targets Android 17 (API 37). The app asks for the Agon organization ID, starts the agent in a user-started foreground service, and displays the device-generated pairing code. It does not auto-start at boot or implement Android screen sharing/input control.
- Android's universal APK is debug-signed for internal sideload testing. Use a stable organization-owned signing key before distributing upgrades broadly.

## Uninstall

Run the included `uninstall` script for the platform, or run the installed binary with `-uninstall -consent` from an elevated shell. Pairing and access changes remain in the control plane audit history.

## Build from source

Requires Go 1.22 or later.

```sh
go mod tidy
go build -trimpath -o agon-agent .
```

Cross compilation uses `CGO_ENABLED=0`, `GOOS`, and `GOARCH`. Windows service integration is compiled only for Windows; Linux/macOS service installers use their native service managers.

The Android APK build uses the included Gradle wrapper, JDK 21, Android SDK API 37, and Build Tools 37.0.0. From the workspace root, run `pnpm --filter @workspace/agon-control run build:android`; the script downloads missing Android SDK components to the ignored `.cache/android-sdk` directory and produces the APK plus its checksum manifest.

## Automated relay smoke test

From the workspace root, run:

```sh
pnpm --filter @workspace/agon-control run test:relay
```

This cross-builds the Linux agent and Windows x64 executable, checks the published API target and installer guards, then runs the Linux agent against an isolated real relay through pairing, approval, WebSocket connection, and relay restart recovery. Replit validation captures each run's output for error tracking. It does not verify Android process execution on a physical device or Windows Service Control Manager, desktop capture, consent dialog, or input behavior without the respective device/VM.
