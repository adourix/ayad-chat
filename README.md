# Duet

A private, self-hosted messenger for a small trusted group.

## Phase 1 foundation

- Invite-only accounts created from the CLI (no public registration)
- Argon2id password hashes and server-side sessions
- Direct conversations and small groups (3–5 members)
- WebSocket text messaging with message IDs and server revisions
- Message history endpoint and reconnect synchronization
- Client-side pending-message outbox with idempotent retries
- Unread counts and read watermarks
- Mobile-first chat shell and PWA offline static shell
- SQLite WAL/FTS5 storage
- Docker Compose deployment with production SPA serving

## Stack

- React + TypeScript + Vite
- Node.js + Fastify + WebSocket
- SQLite WAL + FTS5 + Drizzle schema
- Zod shared protocol
- pnpm workspace monorepo

## Development

Requirements: Node.js 22 LTS and pnpm 10.

```bash
pnpm install
pnpm dev
```

Frontend: http://127.0.0.1:5173  
Backend health: http://127.0.0.1:3000/healthz

## Create accounts

```bash
pnpm --filter @duet/server user:create
```

You will be prompted for username, display name, and password. Usernames are 3–32 characters (letters, numbers, underscore, dot, dash). Passwords are 12–128 characters.

## Deploy

1. Copy `.env.example` to `.env`.
2. Set `ALLOWED_ORIGINS` to your exact public HTTPS origin.
3. Prepare persistent storage:
   ```bash
   mkdir -p data
   sudo chown -R 10001:10001 data
   ```
4. Build and start:
   ```bash
   docker compose up -d --build
   ```
5. Create the first user:
   ```bash
   docker compose exec -it app node server/dist/cli/createUser.js
   ```
6. Configure host nginx using `deploy/nginx.conf` and provide TLS certificates. The example includes WebSocket proxying.

The app container listens on port 3000, published only to host loopback (127.0.0.1).

## CI checks

GitHub Actions currently runs:
- Protocol and database tests
- TypeScript typecheck
- Frontend/backend production builds
- Docker image build
- Service-worker syntax and manifest JSON validation

## Not implemented yet

Attachments, voice messages, message editing/deletion, reactions, typing/presence, push notifications, multi-device read receipts, and end-to-end encryption are future work. Phase 1 is not considered production-ready until runtime smoke tests, restore-tested backups, and TLS/domain configuration have been verified.
