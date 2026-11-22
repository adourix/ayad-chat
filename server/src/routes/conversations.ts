import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db } from "../db/client.js";
import { authenticate } from "../auth/guards.js";
const directSchema = z.object({ user_id: z.number().int().positive() });
const groupSchema = z.object({ title: z.string().trim().min(1).max(80), member_ids: z.array(z.number().int().positive()).min(2).max(4) });
export async function registerConversationRoutes(app: FastifyInstance) {
  app.get("/api/conversations", async (request, reply) => {
    const auth = await authenticate(request);
    if (!auth) return reply.code(401).send({ error: "unauthorized" });
    return db.prepare(`SELECT c.id, c.type, c.title, c.avatar_key, c.updated_at, c.last_message_id,
      m.role, m.joined_at, m.last_read_id, m.last_delivered_id, m.muted, m.archived_at,
      (SELECT body FROM messages x WHERE x.id=c.last_message_id AND x.deleted_at IS NULL) AS last_message_body,
      (SELECT created_at FROM messages x WHERE x.id=c.last_message_id) AS last_message_at
      FROM conversations c JOIN conversation_members m ON m.conversation_id=c.id
      WHERE m.user_id=? AND m.archived_at IS NULL ORDER BY c.updated_at DESC`).all(auth.user_id);
  });
  app.get("/api/conversations/:id/members", async (request, reply) => {
    const auth = await authenticate(request);
    if (!auth) return reply.code(401).send({ error: "unauthorized" });
    const id = Number((request.params as {id:string}).id);
    if (!Number.isSafeInteger(id) || id <= 0) return reply.code(400).send({ error: "invalid_id" });
    const isMember = db.prepare("SELECT 1 FROM conversation_members WHERE conversation_id=? AND user_id=?").get(id, auth.user_id);
    if (!isMember) return reply.code(404).send({ error: "conversation_not_found" });
    return db.prepare("SELECT u.id, u.username, u.display_name, m.role, m.joined_at, m.last_seen_at FROM conversation_members m JOIN users u ON u.id=m.user_id WHERE m.conversation_id=? ORDER BY m.joined_at").all(id);
  });
  app.post("/api/conversations/direct", async (request, reply) => {
    const auth = await authenticate(request);
    if (!auth) return reply.code(401).send({ error: "unauthorized" });
    const parsed = directSchema.safeParse(request.body);
    if (!parsed.success || parsed.data.user_id === auth.user_id) return reply.code(400).send({ error: "invalid_input" });
    const target = db.prepare("SELECT id FROM users WHERE id=?").get(parsed.data.user_id);
    if (!target) return reply.code(404).send({ error: "user_not_found" });
    const pair = [auth.user_id, parsed.data.user_id].sort((a,b)=>a-b);
    const key = pair.join(":");
    const existing = db.prepare("SELECT id FROM conversations WHERE direct_key=?").get(key) as {id:number}|undefined;
    if (existing) return { id: existing.id, created: false };
    const create = db.transaction(() => {
      const c = db.prepare("INSERT INTO conversations(type,created_by,direct_key) VALUES('direct',?,?)").run(auth.user_id,key);
      const cid = Number(c.lastInsertRowid);
      db.prepare("INSERT INTO conversation_members(conversation_id,user_id,role) VALUES(?,?, 'owner'),(?,?, 'member')").run(cid,pair[0],cid,pair[1]);
      return cid;
    });
    try { return reply.code(201).send({ id:create(), created:true }); }
    catch { const raced=db.prepare("SELECT id FROM conversations WHERE direct_key=?").get(key) as {id:number}|undefined; if(raced) return {id:raced.id,created:false}; throw new Error("direct_create_failed"); }
  });
  app.post("/api/conversations/group", async (request, reply) => {
    const auth = await authenticate(request);
    if (!auth) return reply.code(401).send({ error: "unauthorized" });
    const parsed = groupSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_input" });
    const ids = [...new Set([...parsed.data.member_ids.filter(id=>id!==auth.user_id), auth.user_id])];
    if (ids.length < 3) return reply.code(400).send({ error: "group_requires_three_members" });
    const placeholders=ids.map(()=>"?").join(",");
    const users=db.prepare(`SELECT id FROM users WHERE id IN (${placeholders})`).all(...ids) as {id:number}[];
    if(users.length!==ids.length) return reply.code(400).send({ error: "unknown_member" });
    const create=db.transaction(()=>{
      const c=db.prepare("INSERT INTO conversations(type,title,created_by) VALUES('group',?,?)").run(parsed.data.title,auth.user_id);
      const cid=Number(c.lastInsertRowid);
      const insert=db.prepare("INSERT INTO conversation_members(conversation_id,user_id,role) VALUES(?,?,?)");
      for(const id of ids) insert.run(cid,id,id===auth.user_id?"owner":"member");
      return cid;
    });
    return reply.code(201).send({ id:create(), created:true });
  });
}
