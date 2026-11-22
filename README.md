# Duet

A private, self-hosted messenger for a small trusted group. Mobile-first and intended for 2–5 trusted users.

## MVP features

- Private accounts created by CLI only (no public signup)
- Argon2id password hashing and server-side sessions
- Direct conversations and small groups (3–5 members)
- Live text messaging over WebSocket
- Persistent message history and reconnect synchronization
- Pending-message outbox with idempotent retry
- Unread counters and read watermarks
- Mobile-first responsive UI and installable PWA shell
- SQLite WAL + FTS5 schema
- Docker Compose production runtime, health check and persistent data
- Nginx reverse-proxy example with TLS and WebSocket support

## Stack

React + TypeScript + Vite; Node.js + Fastify + WebSocket; SQLite WAL + FTS5; Drizzle; Zod shared protocol; pnpm workspace.

## Development

Requirements: Node.js 22 LTS and pnpm 10.

```bash
pnpm install
pnpm dev
```

Frontend: http://127.0.0.1:5173  
Backend health: http://127.0.0.1:3000/healthz

## Create users

No public registration. Create accounts from the server:

```bash
pnpm --filter @duet/server user:create
```

Prompted fields: username, display name, password. Usernames are 3–32 characters. Passwords are 12–128 characters.

## Server deployment (Docker Compose)

1. Install Docker Engine + Compose plugin and Nginx on the server.
2. Clone and enter the repo:
   ```bash
   git clone https://github.com/adourix/ayad-chat.git
   cd ayad-chat
   ```
3. Configure environment:
   ```bash
   cp .env.example .env
   nano .env
   ```
   Set `ALLOWED_ORIGINS` to the exact public HTTPS origin (example: `https://chat.example.com`). Keep `SESSION_COOKIE_NAME=__Host-duet_session` when serving over HTTPS. Do not add a trailing slash.
4. Create persistent storage and permissions:
   ```bash
   mkdir -p data
   sudo chown -R 10001:10001 data
   ```
5. Build and start:
   ```bash
   docker compose up -d --build
   docker compose ps
   docker compose logs -f app
   ```
6. Check locally:
   ```bash
   curl -fsS http://127.0.0.1:3000/healthz
   ```
7. Configure TLS in Nginx using `deploy/nginx.conf`. Replace `chat.example.com` and certificate paths with your real domain/certificates. Include the file inside Nginx's `http {}` context (not inside another `server {}`). Test and reload:
   ```bash
   sudo nginx -t
   sudo systemctl reload nginx
   ```
8. Create accounts:
   ```bash
   docker compose exec -it app node server/dist/cli/createUser.js
   ```
9. Open the HTTPS domain and sign in.

The app binds to host loopback only (`127.0.0.1:3000`); expose it through HTTPS reverse proxy, not directly to the internet.

## Update the server

```bash
git pull
docker compose up -d --build
docker compose ps
curl -fsS http://127.0.0.1:3000/healthz
```

## Backup and restore

Backup briefly stops the app to archive the SQLite data directory consistently (including sidecar files), then restarts it.

```bash
chmod +x deploy/backup.sh deploy/restore.sh
./deploy/backup.sh
```

Backups are stored in `./backups/`. Copy them off-server regularly.

Restore (destructive; the script makes a dated copy of the current data folder first):

```bash
./deploy/restore.sh ./backups/duet-YYYYMMDDTHHMMSSZ.tar.gz
```

## CI

GitHub Actions checks:
- Shared protocol and SQLite tests
- TypeScript typecheck
- Frontend and backend production builds
- Service-worker syntax and PWA manifest validity
- Docker image build and runtime smoke test (`/healthz` and SPA response)

## MVP scope / not included yet

MVP focuses on private text conversations. Attachments/media, voice messages, message edit/delete, reactions, typing/presence, push notifications, multi-device read receipts, and end-to-end encryption are not implemented yet. Before relying on it for sensitive conversations, configure TLS, firewall, off-server backups, and test restore.
