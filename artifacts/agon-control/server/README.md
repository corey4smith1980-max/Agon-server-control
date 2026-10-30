# Agon control plane

A relay for explicitly managed endpoints. Agents make outbound WebSocket connections, so endpoints do not need inbound firewall ports. The relay authenticates enrollment, stores only hashed device credentials, dispatches an allowlisted job protocol, and retains a chronological audit list.

## Run locally

Requires Node.js 20 or later.

```sh
npm ci
export ENROLLMENT_TOKEN="$(openssl rand -base64 36)"
export ADMIN_TOKEN="$(openssl rand -base64 48)"
npm start
```

Set `ALLOW_ORIGIN` to the exact origin of the Agon console (for local development, `http://localhost:5173`). The service refuses to start without separate, 32-character `ENROLLMENT_TOKEN` and `ADMIN_TOKEN` values. Open `http://localhost:8787/health` to check the relay. Plain HTTP is intended only for local development. Put the service behind an HTTPS reverse proxy (Caddy, nginx, or a managed load balancer) before enrolling devices over a network.

## Docker

```sh
cp .env.example .env
# Replace both tokens and set your console origin in .env
docker compose up --build -d
```

For multiple regions, deploy one instance per region with a unique `RELAY_ID` and durable volume. Use your DNS/global load-balancer policy to route each enrollment package to its preferred region. Each instance is an independent trust domain; do not copy device credential databases between regions.

## Agent installation

The console's Deployment page bundles a compiled agent, `agent.json`, and a platform installer. Installation requires an explicit consent flag. Run the installer from an elevated terminal only on devices you own or administer. Windows registers `AgonAgent` with Service Control Manager; Linux installs a systemd unit; macOS installs a LaunchDaemon. Android uses a visible MDM/ADB-managed binary and does not configure hidden boot persistence.

## Protocol

- `POST /api/enroll` exchanges the site enrollment token for a random per-device token.
- `GET /api/devices`, `/api/jobs`, `/api/sessions`, and `/api/audit` require `Authorization: Bearer ADMIN_TOKEN`.
- `POST /api/devices/:id/commands` accepts only `agent.ping`, `inventory.refresh`, `diagnostics.network`, and `session.request`.
- Agents connect to `/agent?deviceId=...` and authenticate using an Authorization header. Operators that use the optional WebSocket feed authenticate via WebSocket subprotocols, not URL query tokens.
- `POST /api/sessions` creates a short-lived support request. Agents honoring interactive-only policy reject unattended requests until endpoint policy permits them.

This relay intentionally omits arbitrary shell execution, credential collection, screen capture, input injection, and covert persistence. Support requests report consent and endpoint-policy status only; they do not create a remote desktop or live chat. Add other capabilities only through separately reviewed, platform-native, consent-visible support modules.
