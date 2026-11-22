import type {FastifyInstance} from "fastify";
import {db} from "../db/client.js";
import {authenticate} from "../auth/guards.js";
const pageSize=50;
export async function registerMessageRoutes(app:FastifyInstance){
 app.post("/api/conversations/:id/read",async(request,reply)=>{
  const auth=await authenticate(request);if(!auth)return reply.code(401).send({error:"unauthorized"});
  const cid=Number((request.params as {id:string}).id);if(!Number.isSafeInteger(cid)||cid<=0)return reply.code(400).send({error:"invalid_id"});
  const member=db.prepare("SELECT joined_at FROM conversation_members WHERE conversation_id=? AND user_id=?").get(cid,auth.user_id) as {joined_at:string}|undefined;if(!member)return reply.code(404).send({error:"conversation_not_found"});
  const latest=db.prepare("SELECT COALESCE(MAX(id),0) AS id FROM messages WHERE conversation_id=? AND created_at>=?").get(cid,member.joined_at) as {id:number};
  db.prepare("UPDATE conversation_members SET last_read_id=MAX(last_read_id,?) WHERE conversation_id=? AND user_id=?").run(latest.id,cid,auth.user_id);return {read_up_to:latest.id};
 });
 app.get("/api/conversations/:id/messages",async(request,reply)=>{
  const auth=await authenticate(request);if(!auth)return reply.code(401).send({error:"unauthorized"});
  const cid=Number((request.params as {id:string}).id);
  const before=Number((request.query as {before?:string}).before??Number.MAX_SAFE_INTEGER);
  if(!Number.isSafeInteger(cid)||cid<=0||!Number.isSafeInteger(before)||before<=0)return reply.code(400).send({error:"invalid_pagination"});
  const member=db.prepare("SELECT joined_at FROM conversation_members WHERE conversation_id=? AND user_id=?").get(cid,auth.user_id) as {joined_at:string}|undefined;
  if(!member)return reply.code(404).send({error:"conversation_not_found"});
  const rows=db.prepare(`SELECT id,conversation_id,sender_id,client_id,kind,body,body_format,reply_to_id,created_at,edited_at,deleted_at,rev
   FROM messages WHERE conversation_id=? AND id<? AND created_at>=? ORDER BY id DESC LIMIT ?`).all(cid,before,member.joined_at,pageSize) as Record<string,unknown>[];
  return {messages:rows.reverse(),has_more:rows.length===pageSize};
 });
}
