# Duet

Private, self-hosted messaging for a small trusted group.

## Stack

- React + TypeScript + Vite (SPA)
- Node.js + Fastify + WebSocket
- SQLite WAL + FTS5
- Zod shared protocol
- pnpm workspace monorepo

## Requirements

- Node.js 22 LTS
- pnpm 10

## Development

```bash
pnpm install
pnpm dev
```

Frontend: http://127.0.0.1:5173  
Backend: http://127.0.0.1:3000/healthz

The shared package is built automatically before development starts.

## Create the first account

```bash
pnpm --filter @duet/server user:create
```

The command prompts for username, display name, and password. Usernames may contain letters, numbers, dots, dashes, and underscores. Passwords must be at least 12 characters.

## Deployment

1. Copy `.env.example` to `.env` and set your public HTTPS origin in `ALLOWED_ORIGINS`.
2. Create the persistent data directory and make it writable by UID 10001:
   `mkdir -p data && sudo chown -R 10001:10001 data`
3. Build and start: `docker compose up -d --build`
4. Create users inside the running container:
   `docker compose exec app node server/dist/cli/createUser.js` (the production image currently includes the CLI entrypoint only if the build outputs it; see setup notes before relying on this command).
5. Put nginx in front of the container with HTTPS and WebSocket proxying. Example: `deploy/nginx.conf`.

## Current status

Foundation and initial messaging endpoints are being implemented. Authentication, conversation APIs, WebSocket send/receive, and UI are not yet considered production-ready until the CI build and integration checks pass.
