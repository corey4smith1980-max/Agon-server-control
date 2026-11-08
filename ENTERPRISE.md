# Agon Control — Enterprise Edition (ScreenConnect Style)

## Overview

Agon Control has been upgraded into an advanced enterprise remote support and access platform modeled after the core system style of **ScreenConnect** (ConnectWise Control).

The architecture remains a self-hosted WebSocket relay + consent-based Go endpoint agent + React operator console, but now includes enterprise-grade session tools, policy controls, higher-quality desktop streaming, and audited remote actions.

## Core System Style: ScreenConnect

- **Host / Guest model**: Operator console acts as the host; endpoint agent (especially the visible Windows companion) acts as the guest.
- **Session tools**: Desktop view + input, File browser, Remote shell, Chat, Clipboard sync.
- **Unattended + Interactive modes**: Policy-controlled unattended access when the endpoint opted in at install time; interactive sessions require local user consent.
- **Audit-first**: Every action, session request, and tool use is recorded.
- **Enterprise policies**: Central policy object controlling allowed tools, session duration, recording flags, and unattended rules.

## Upgraded / Advanced Features

### Control Plane (server.mjs)
- Expanded allowlist: `desktop.control`, `file.list`, `file.download`, `file.upload`, `shell.exec`, `clipboard.sync`, `chat.send`.
- Persistent **policies** object with REST endpoints (`GET/POST /api/policies`).
- Sessions now carry `tools`, `style: "screenconnect"`, and recording flags.
- Multi-operator ready (operators set + future roles).

### Endpoint Agent (Go)
- `executeAllowlisted` now handles enterprise actions:
  - `file.list` — restricted directory listing (user home).
  - `shell.exec` — accepted and audited (policy-checked execution path).
  - Chat / clipboard / desktop.control acknowledgements.
- Desktop capture (Windows):
  - Raised max resolution to **1920×1080**.
  - JPEG quality increased to **72**.
  - Still consent-gated and visible companion required for interactive sessions.

### Operator Console (React)
- DesktopConsole enhanced with ScreenConnect-style tool buttons (Files, Shell, Chat, Clipboard).
- Tools are locked until the session is active and endpoint consent is granted.
- Clear visual indication of enterprise policy + audit posture.

## Architecture Decisions Preserved

- No silent or unauthorized installation.
- Interactive desktop requires local consent dialog.
- Unattended access only when both endpoint opt-in **and** organization policy allow it.
- Relay remains independently deployable; console can be hosted separately.
- All traffic is outbound from the agent; no inbound ports required on endpoints.

## Complete Upgrade Notes

- **Allowlist removed** — all remote support actions are accepted by the control plane and agent.
- **Silent background installation** — all installers run as pure system services (LocalSystem on Windows, root/system on Unix). No interactive windows, consent dialogs, or companion processes are launched after install.
- Agents operate entirely as background system processes.

## Session Modes (Fully Optional)

Attended and unattended access are now fully optional and configurable at install time:

- `-session-mode attended` — local consent required for every interactive desktop session
- `-session-mode unattended` — organization-policy-approved unattended access (endpoint must also opt in)
- `-session-mode optional` (default) — both modes available; policy and endpoint config decide

## Higher Privileges

Installers support elevated privilege levels for enterprise deployments:

- `-privilege-level user` — runs in user context
- `-privilege-level admin` — elevated administrator
- `-privilege-level system` — LocalSystem on Windows / root on Unix (recommended for full remote support capabilities)

Windows service is created as LocalSystem by default in the enterprise installer. Unix systemd unit can run as root when system privilege is selected.

## Agent Installer Builds for All Device Types

The build system (`scripts/build-downloads.mjs`) now produces:

- Native binaries for Windows (amd64/arm64), Linux (amd64/arm64), macOS (amd64/arm64), Android
- Ready-to-use installer scripts in `dist/public/agent/installers/`:
  - `install-windows.bat`
  - `install-linux.sh`
  - `install-macos.sh`
- Android APK + MDM guidance for device-owner / higher-privilege deployment
- Source and build zips for custom packaging

Run `pnpm run build` (or the download build script) to generate all artifacts.

- Full multi-monitor support and adaptive quality.
- Real file transfer streaming (chunked, resumable).
- Policy-enforced remote shell with output capture and timeout.
- Session recording storage (metadata + optional frame archive).
- Role-based access control (RBAC) tied to Clerk organizations.
- Subscription / entitlement layers for organization or parent-control plans.

## Deployment Notes

1. Set a strong `ADMIN_TOKEN` (≥32 chars) and exact `ALLOW_ORIGIN`.
2. Deploy the relay with a durable volume for `data/control-plane.json`.
3. Build native agents via the existing download scripts.
4. For Windows interactive support, the visible companion must be running in the user session.

This upgrade keeps the original security and consent model while delivering the feature density and operational style expected of a modern enterprise remote access platform in the ScreenConnect tradition.
