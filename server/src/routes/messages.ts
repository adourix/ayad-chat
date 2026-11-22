import type {FastifyInstance} from "fastify";
import {db} from "../db/client.js";
import {authenticate} from "../auth/guards.js";
const pageSize=50;
function hydrate(rows:Record<string,unknown>[]){return rows.map(row=>{const reactions=db.prepare("SELECT user_id,emoji FROM reactions WHERE message_id=? ORDER BY emoji").all(Number(row.id)) as {user_id:number;emoji:string}[];const base={...row,reactions};return row.attachment_id?{...base,attachment:{id:row.attachment_id,mime:row.attachment_mime,size:row.attachment_size,width:row.attachment_width??null,height:row.attachment_height??null,duration_ms:row.attachment_duration??null,url:"/api/media/"+row.attachment_id}}:base;});}
export async function registerMessageRoutes(app:FastifyInstance){
 app.post("/api/conversations/:id/read",async(request,reply)=>{
  const auth=await authenticate(request);if(!auth)return reply.code(401).send({error:"unauthorized"});
  const cid=Number((request.params as {id:string}).id);if(!Number.isSafeInteger(cid)||cid<=0)return reply.code(400).send({error:"invalid_id"});
  const member=db.prepare("SELECT joined_at FROM conversation_members WHERE conversation_id=? AND user_id=?").get(cid,auth.user_id) as {joined_at:string}|undefined;if(!member)return reply.code(404).send({error:"conversation_not_found"});
  const latest=db.prepare("SELECT COALESCE(MAX(id),0) AS id FROM messages WHERE conversation_id=? AND created_at>=?").get(cid,member.joined_at) as {id:number};
  db.prepare("UPDATE conversation_members SET last_read_id=MAX(last_read_id,?) WHERE conversation_id=? AND user_id=?").run(latest.id,cid,auth.user_id);return {read_up_to:latest.id};
 });
 app.get("/api/conversations/:id/media",async(request,reply)=>{
  const auth=await authenticate(request);if(!auth)return reply.code(401).send({error:"unauthorized"});
  const cid=Number((request.params as {id:string}).id);if(!Number.isSafeInteger(cid)||cid<=0)return reply.code(400).send({error:"invalid_id"});
  const member=db.prepare("SELECT joined_at FROM conversation_members WHERE conversation_id=? AND user_id=?").get(cid,auth.user_id) as {joined_at:string}|undefined;if(!member)return reply.code(404).send({error:"conversation_not_found"});
  const rows=db.prepare(`SELECT m.id,m.conversation_id,m.sender_id,m.client_id,m.kind,m.created_at,a.id AS attachment_id,a.mime AS attachment_mime,a.size AS attachment_size,a.width AS attachment_width,a.height AS attachment_height,a.duration_ms AS attachment_duration FROM messages m JOIN attachments a ON a.id=m.attachment_id WHERE m.conversation_id=? AND m.created_at>=? AND m.kind IN ('image','video') AND m.deleted_at IS NULL ORDER BY m.id DESC`).all(cid,member.joined_at) as Record<string,unknown>[];
  return {items:rows.map(row=>({...row,attachment:{id:row.attachment_id,mime:row.attachment_mime,size:row.attachment_size,width:row.attachment_width??null,height:row.attachment_height??null,duration_ms:row.attachment_duration??null,url:"/api/media/"+row.attachment_id}}))};
 });
 app.get("/api/conversations/:id/search",{config:{rateLimit:{max:40,timeWindow:"1 minute"}}},async(request,reply)=>{
  const auth=await authenticate(request);if(!auth)return reply.code(401).send({error:"unauthorized"});
  const cid=Number((request.params as {id:string}).id),query=String((request.query as {q?:string}).q??"").trim().slice(0,120);
  if(!Number.isSafeInteger(cid)||cid<=0)return reply.code(400).send({error:"invalid_id"});
  if(query.length<2)return {items:[]};
  const member=db.prepare("SELECT joined_at FROM conversation_members WHERE conversation_id=? AND user_id=?").get(cid,auth.user_id) as {joined_at:string}|undefined;if(!member)return reply.code(404).send({error:"conversation_not_found"});
  try{const ftsQuery=query.split(/\s+/).filter(Boolean).map(term=>"\""+term.replace(/"/g,"\"\"")+"\"").join(" AND ");const rows=db.prepare("SELECT m.id,m.conversation_id,m.sender_id,m.client_id,m.kind,m.body,m.created_at FROM messages_fts f JOIN messages m ON m.id=f.rowid WHERE messages_fts MATCH ? AND m.conversation_id=? AND m.created_at>=? AND m.deleted_at IS NULL ORDER BY m.id DESC LIMIT 50").all(ftsQuery,cid,member.joined_at) as Record<string,unknown>[];return {items:rows};}catch{return reply.code(400).send({error:"invalid_search"});}
 });
 app.get("/api/conversations/:id/messages",async(request,reply)=>{
  const auth=await authenticate(request);if(!auth)return reply.code(401).send({error:"unauthorized"});
  const cid=Number((request.params as {id:string}).id);
  const before=Number((request.query as {before?:string}).before??Number.MAX_SAFE_INTEGER);
  if(!Number.isSafeInteger(cid)||cid<=0||!Number.isSafeInteger(before)||before<=0)return reply.code(400).send({error:"invalid_pagination"});
  const member=db.prepare("SELECT joined_at FROM conversation_members WHERE conversation_id=? AND user_id=?").get(cid,auth.user_id) as {joined_at:string}|undefined;
  if(!member)return reply.code(404).send({error:"conversation_not_found"});
  const rows=db.prepare(`SELECT m.id,m.conversation_id,m.sender_id,m.client_id,m.kind,m.body,m.body_format,m.reply_to_id,m.created_at,m.edited_at,m.deleted_at,m.rev,
   a.id AS attachment_id,a.mime AS attachment_mime,a.size AS attachment_size,a.width AS attachment_width,a.height AS attachment_height,a.duration_ms AS attachment_duration
   FROM messages m LEFT JOIN attachments a ON a.id=m.attachment_id
   WHERE m.conversation_id=? AND m.id<? AND m.created_at>=? ORDER BY m.id DESC LIMIT ?`).all(cid,before,member.joined_at,pageSize) as Record<string,unknown>[];
  return {messages:hydrate(rows.reverse()),has_more:rows.length===pageSize};
 });
}
