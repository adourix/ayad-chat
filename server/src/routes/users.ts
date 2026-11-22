import type { FastifyInstance } from "fastify";
import { db } from "../db/client.js";
import { authenticate } from "../auth/guards.js";
export async function registerUserRoutes(app: FastifyInstance) {
  app.get("/api/users", async (request, reply) => {
    const auth=await authenticate(request);
    if(!auth) return reply.code(401).send({error:"unauthorized"});
    const q=((request.query as {q?:string}).q??"").trim().slice(0,40);
    if(!q) return { users:[] };
    return { users:db.prepare("SELECT id,username,display_name FROM users WHERE id<>? AND (username LIKE ? OR display_name LIKE ?) ORDER BY display_name LIMIT 20").all(auth.user_id,`%${q}%`,`%${q}%`) };
  });
}
