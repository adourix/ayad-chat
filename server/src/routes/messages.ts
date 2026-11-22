import type { FastifyInstance } from "fastify";
import { db } from "../db/client.js";
import { authenticate } from "../auth/guards.js";
const pageSize = 50;
export async function registerMessageRoutes(app: FastifyInstance) {
  app.get("/api/conversations/:id/messages", async (request, reply) => {
    const auth = await authenticate(request);
    if (!auth) return reply.code(401).send({ error:"unauthorized" });
    const params=request.params as {id:string};
    const cid=Number(params.id);
    const before=Number((request.query as {before?:string}).before ?? Number.MAX_SAFE_INTEGER);
    const member=db.prepare("SELECT joined_at FROM conversation_members WHERE conversation_id=? AND user_id=?").get(cid,auth.user_id) as {joined_at:string}|undefined;
    if(!member) return reply.code(404).send({error:"conversation_not_found"});
    if(!Number.isSafeInteger(cid)||cid<=0||!Number.isSafeInteger(before)) return reply.code(400).send({error:"invalid_pagination"});
    const rows=db.prepare(`SELECT id,conversation_id,sender_id,client_id,kind,body,body_format,reply_to_id,created_at,edited_at,deleted_at,rev
      FROM messages WHERE conversation_id=? AND id<? AND created_at>=? ORDER BY id DESC LIMIT ?`).all(cid,before,member.joined_at,pageSize) as Record<string,unknown>[];
    return { messages:rows.reverse(), has_more:rows.length===pageSize };
  });
}
