# Duet

Private, self-hosted messaging for a small trusted group.

## Stack

- React + TypeScript + Vite
- Node.js + Fastify + WebSocket
- SQLite (WAL) + Drizzle ORM
- Zod shared protocol
- pnpm workspace

## Requirements

- Node.js 22 LTS
- pnpm 10

## Development

```bash
pnpm install
cp server/.env.example server/.env
pnpm dev
```

The API runs on http://127.0.0.1:3000 and the Vite app on http://127.0.0.1:5173.

## Status

Foundation in progress. See [project specification](./ayad-chat.md) for architecture and roadmap.
