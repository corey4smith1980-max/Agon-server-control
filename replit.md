# Agon Server Control

Agon is a web console for explicitly managed endpoint inventory, support-policy requests, and a small allowlist of remote diagnostics.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/agon-control run dev` — run the Agon console
- `pnpm --filter @workspace/agon-control run typecheck` — typecheck the console
- `pnpm --filter @workspace/agon-control run build` — build the console, cross-platform agents, and downloadable relay/source archives
- The Go toolchain is required; the `dev` command builds the native agent artifacts before starting Vite.
- Run the self-hosted relay from the downloaded Agon server bundle with Docker Compose or Node.js 20+; do not start it with the unrelated shared API workflow.

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `artifacts/agon-control/src/` — console UI and relay client
- `artifacts/agon-control/agent/` — consent-based Go endpoint agent
- `artifacts/agon-control/server/` — independently deployable Node.js relay
- `artifacts/agon-control/scripts/build-downloads.mjs` — native agent and source-archive build

## Architecture decisions

- The relay is self-hosted by the operator; console hosting and relay hosting are separate.
- Relay commands are an explicit allowlist (`agent.ping`, `inventory.refresh`, `diagnostics.network`, `session.request`); there is no arbitrary shell, screen capture, keyboard/mouse control, or remote desktop.
- Lab fleet records are simulated and remain separate from relay-synchronized records.
- The relay uses a persistent JSON store and should be deployed with its Docker volume or another durable data directory.

## Product

- View lab sample devices and synchronize real enrolled devices, jobs, support requests, and relay audit records.
- Request only endpoint-consent or endpoint-policy status; support requests do not open a remote-control session.
- Build checksummed, configured endpoint packages for Windows, macOS, Linux, and Android ARM64.
- Run a private operator console using a self-hosted relay, separate enrollment/admin tokens, and an exact allowed browser origin.

## User preferences

The console currently uses a shared relay administrator bearer token kept in browser session storage; it does not provide account-level sign-in. Keep the published console private until an organization identity provider or equivalent operator authentication is configured.

## Gotchas

- `ALLOW_ORIGIN` must exactly match the published console origin; use HTTPS outside localhost development.
- Configure separate random `ENROLLMENT_TOKEN` and `ADMIN_TOKEN` values of at least 32 characters before starting the relay.
- Native installers include the enrollment token. Distribute packages through an approved secure channel and rotate the enrollment token after enrollment if the policy allows.
- Downloadable native binaries and ZIP bundles are generated in ignored build output; do not commit build artifacts.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
