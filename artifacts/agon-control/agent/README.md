# Agon endpoint agent

Version 1.0.0 — consent-based inventory and diagnostics for managed devices.

## What the agent does

The agent makes an outbound TLS WebSocket connection to the relay URL in `agent.json`. On first setup it creates a stable device ID and a random device credential locally, then prints a pairing code. The credential remains inactive until an operator enters that code in the console. It reports basic host inventory and responds only to four allowlisted operations: ping, inventory refresh, network-interface diagnostics, and support-session authorization. It does not provide arbitrary shell execution, credential collection, hidden startup, screen capture, or input injection.

## Interactive run

```sh
./agon-agent -config agent.json
```

Stop with Ctrl+C. The endpoint must use HTTPS/WSS except for localhost development. For a new device, run `./agon-agent -config agent.json -pair`, then enter the printed pairing code in the signed-in console.

## Service installation

Use the generated package from the console. It contains the right binary, configuration, and installer. Service installation always requires `-consent` and elevated privileges where applicable.

- Windows: `install.ps1` registers a real Windows service named `AgonAgent`.
- Linux: `install.sh` installs a hardened systemd unit running as the `agonagent` system user.
- macOS: `install.sh` installs a LaunchDaemon visible as `com.agon.agent`.
- Android: `install-android.sh` uses ADB to place and start the ARM64 binary. Production boot persistence must be granted explicitly by your MDM; no covert persistence is configured.

## Uninstall

Run the included `uninstall` script for the platform, or run the installed binary with `-uninstall -consent` from an elevated shell. Pairing and access changes remain in the control plane audit history.

## Build from source

Requires Go 1.22 or later.

```sh
go mod tidy
go build -trimpath -o agon-agent .
```

Cross compilation uses `CGO_ENABLED=0`, `GOOS`, and `GOARCH`. Windows service integration is compiled only for Windows; Linux/macOS service installers use their native service managers.

## Automated relay smoke test

From the workspace root, run:

```sh
pnpm --filter @workspace/agon-control run test:relay
```

This cross-builds the Linux agent and Windows x64 executable, checks key Windows installer guards, then runs the Linux agent against an isolated real relay through pairing, approval, WebSocket connection, and relay restart recovery. Replit validation captures each run's output for error tracking. This is not a Windows VM test: it cannot verify Windows Service Control Manager behavior without an actual Windows VM.
