# OutreachIt

TypeScript pnpm workspace for an email outreach manager.

## Requirements

- Node.js 22.13+ (22.x), or Node.js 24+
- pnpm 10.22.0

## Development

```sh
pnpm install
pnpm dev
```

Client: http://127.0.0.1:5173. API: http://127.0.0.1:3001/api/health.
Vite proxies `/api` requests to the server in development.

Server settings are optional. To customize them, copy `apps/server/.env.example`
to `apps/server/.env`. Keep the server port and Vite proxy target in sync.

## Workspace

- `apps/client`: React + Vite
- `apps/server`: Express API
- `packages/shared`: shared TypeScript contracts

The root development command builds shared contracts first, then watches all
three packages. Build commands run in dependency order.

## Checks and production build

```sh
pnpm lint
pnpm typecheck
pnpm build
pnpm --filter @outreachit/server start
```

`pnpm --filter @outreachit/client preview` previews the built client locally.
Production hosting must serve `apps/client/dist` and forward `/api` to the server.

This scaffold contains a minimal landing screen and health endpoint. Database
connections and outreach features will be added in subsequent work.
