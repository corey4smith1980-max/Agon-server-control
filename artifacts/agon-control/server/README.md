# Agon control plane

A relay for explicitly managed endpoints. Agents make outbound WebSocket connections, so endpoints do not need inbound firewall ports. Agents generate their own credentials; the relay stores only hashes and activates a device only after an operator confirms its pairing code.

## Run locally

Requires Node.js 20 or later.

```sh
npm ci
export ADMIN_TOKEN="$(openssl rand -base64 48)"
npm start
```

Set `ALLOW_ORIGIN` to the exact HTTPS origin of the Agon console. The service requires a 32-character `ADMIN_TOKEN`; agents do not share a relay-wide enrollment secret. Open `http://localhost:8787/health` to check the relay. Plain HTTP is intended only for local development. Put the service behind an HTTPS reverse proxy (Caddy, nginx, or a managed load balancer) before pairing devices over a network.

## Docker

```sh
cp .env.example .env
# Set ADMIN_TOKEN and ALLOW_ORIGIN in .env
docker compose up --build -d
```

For multiple regions, deploy one instance per region with a unique `RELAY_ID` and durable volume. Use your DNS/global load-balancer policy to route each configured agent to its preferred region. Each instance is an independent trust domain; do not copy device credential databases between regions.

## Agent installation

The console's Deployment page bundles a compiled agent, `agent.json`, and a platform installer. Installation requires an explicit consent flag. Run the installer from an elevated terminal only on devices you own or administer. Windows registers `AgonAgent` with Service Control Manager; Linux installs a systemd unit; macOS installs a LaunchDaemon. Android uses a visible MDM/ADB-managed binary and does not configure hidden boot persistence.

## Protocol

- `POST /api/pair-requests` records an unapproved device request. The agent generates its own ID, credential, and one-time pairing code; it sends `X-Requested-With: XMLHttpRequest`.
- `GET /api/pending-devices` requires `Authorization: Bearer ADMIN_TOKEN` and lists safe device metadata.
- `POST /api/pending-devices/:id/approve` requires the admin token and JSON `{ "pairingCode": "..." }`. The pairing code is printed on the endpoint during setup.
- `DELETE /api/pending-devices/:id` ignores an unapproved request.
- `GET /api/devices`, `/api/jobs`, `/api/sessions`, and `/api/audit` require `Authorization: Bearer ADMIN_TOKEN`.
- `POST /api/devices/:id/commands` accepts only `agent.ping`, `inventory.refresh`, `diagnostics.network`, and `session.request`.
- Agents connect to `/agent?deviceId=...` and authenticate using an Authorization header. Operators that use the optional WebSocket feed authenticate via WebSocket subprotocols, not URL query tokens.
- `POST /api/sessions` creates a short-lived support request. Agents honoring interactive-only policy reject unattended requests until endpoint policy permits them.

This relay intentionally omits arbitrary shell execution, credential collection, screen capture, input injection, and covert persistence. Support requests report consent and endpoint-policy status only; they do not create a remote desktop or live chat. Add other capabilities only through separately reviewed, platform-native, consent-visible support modules.
