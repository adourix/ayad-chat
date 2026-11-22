import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db } from "../db/client.js";
import { authenticate } from "../auth/guards.js";
import { hashPassword, verifyPassword, validPassword } from "../auth/password.js";

const accountSchema = z.object({
  username: z.string().trim().min(3).max(32).regex(/^[a-zA-Z0-9_.-]+$/),
  display_name: z.string().trim().min(1).max(80),
});
const passwordSchema = z.object({
  current_password: z.string().min(1).max(128),
  new_password: z.string().min(12).max(128),
});

export async function registerUserRoutes(app: FastifyInstance) {
  app.get("/api/users", async (request, reply) => {
    const auth = await authenticate(request);
    if (!auth) return reply.code(401).send({ error: "unauthorized" });
    const q = ((request.query as { q?: string }).q ?? "").trim().slice(0, 40);
    if (!q) return { users: [] };
    return {
      users: db.prepare("SELECT id,username,display_name FROM users WHERE id<>? AND (username LIKE ? OR display_name LIKE ?) ORDER BY display_name LIMIT 20")
        .all(auth.user_id, `%${q}%`, `%${q}%`),
    };
  });

  app.patch("/api/users/me", async (request, reply) => {
    const auth = await authenticate(request);
    if (!auth) return reply.code(401).send({ error: "unauthorized" });
    const parsed = accountSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_input" });
    const { username, display_name } = parsed.data;
    const existing = db.prepare("SELECT id FROM users WHERE username=? COLLATE NOCASE AND id<>?").get(username, auth.user_id);
    if (existing) return reply.code(409).send({ error: "username_taken" });
    db.prepare("UPDATE users SET username=?,display_name=? WHERE id=?").run(username, display_name, auth.user_id);
    return { user: { id: auth.user_id, username, display_name } };
  });

  app.post("/api/users/me/password", async (request, reply) => {
    const auth = await authenticate(request);
    if (!auth) return reply.code(401).send({ error: "unauthorized" });
    const parsed = passwordSchema.safeParse(request.body);
    if (!parsed.success || !validPassword(parsed.data?.new_password ?? "")) return reply.code(400).send({ error: "invalid_input" });
    const row = db.prepare("SELECT password_hash FROM users WHERE id=?").get(auth.user_id) as { password_hash: string } | undefined;
    if (!row || !(await verifyPassword(row.password_hash, parsed.data.current_password))) return reply.code(401).send({ error: "current_password_incorrect" });
    const hash = await hashPassword(parsed.data.new_password);
    db.prepare("UPDATE users SET password_hash=? WHERE id=?").run(hash, auth.user_id);
    db.prepare("UPDATE sessions SET revoked_at=? WHERE user_id=? AND id<>? AND revoked_at IS NULL").run(new Date().toISOString(), auth.user_id, auth.session_id);
    return { ok: true };
  });
}
