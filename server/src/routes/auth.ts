import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { config } from "../config.js";
import { db } from "../db/client.js";
import { authenticate } from "../auth/guards.js";
import { createSession, revokeSession } from "../auth/session.js";
import { verifyPassword } from "../auth/password.js";

const loginSchema = z.object({ username: z.string().trim().min(1).max(32), password: z.string().min(1).max(128), device_label: z.string().trim().max(120).optional() });
export async function registerAuthRoutes(app: FastifyInstance) {
  app.post("/api/auth/login", { config: { rateLimit: { max: 8, timeWindow: "10 minutes" } } }, async (request, reply) => {
    const parsed = loginSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_input" });
    const { username, password, device_label } = parsed.data;
    const user = db.prepare("SELECT id, username, display_name, password_hash FROM users WHERE username=? COLLATE NOCASE").get(username) as
      { id:number; username:string; display_name:string; password_hash:string } | undefined;
    const ok = user ? await verifyPassword(user.password_hash, password) : false;
    if (!ok || !user) return reply.code(401).send({ error: "invalid_credentials" });
    const session = createSession(user.id, device_label);
    reply.setCookie(config.SESSION_COOKIE_NAME, session.token, {
      path: "/", httpOnly: true, secure: true, sameSite: "strict", expires: session.expires,
    });
    return { user: { id:user.id, username:user.username, display_name:user.display_name } };
  });
  app.post("/api/auth/logout", async (request, reply) => {
    const user = await authenticate(request);
    if (user) revokeSession(user.session_id);
    reply.clearCookie(config.SESSION_COOKIE_NAME, { path: "/", secure: true, httpOnly: true, sameSite: "strict" });
    return { ok: true };
  });
  app.get("/api/auth/me", async (request, reply) => {
    const user = await authenticate(request);
    if (!user) return reply.code(401).send({ error: "unauthorized" });
    return { user: { id:user.user_id, username:user.username, display_name:user.display_name } };
  });
}
