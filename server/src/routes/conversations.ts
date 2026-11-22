import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db } from "../db/client.js";
import { authenticate } from "../auth/guards.js";
const directSchema=z.object({user_id:z.number().int().positive()});
const groupSchema=z.object({title:z.string().trim().min(1).max(80),member_ids:z.array(z.number().int().positive()).min(2).max(4)});
export async function registerConversationRoutes(app:FastifyInstance){
 app.get("/api/conversations",async(request,reply)=>{
  const auth=await authenticate(request);if(!auth)return reply.code(401).send({error:"unauthorized"});
  return db.prepare(`SELECT c.id,c.type,
    CASE WHEN c.type='direct' THEN (SELECT u.display_name FROM conversation_members mx JOIN users u ON u.id=mx.user_id WHERE mx.conversation_id=c.id AND mx.user_id<>? LIMIT 1) ELSE c.title END AS title,\n    CASE WHEN c.type='direct' THEN (SELECT CASE WHEN u.avatar_attachment_id IS NULL THEN NULL ELSE '/api/media/'||u.avatar_attachment_id END FROM conversation_members mx JOIN users u ON u.id=mx.user_id WHERE mx.conversation_id=c.id AND mx.user_id<>? LIMIT 1) ELSE NULL END AS avatar_url,
    c.avatar_key,c.updated_at,c.last_message_id,m.role,m.joined_at,m.last_read_id,m.last_delivered_id,m.muted,m.archived_at,
    (SELECT COUNT(*) FROM messages um WHERE um.conversation_id=c.id AND um.id>m.last_read_id AND um.sender_id<>? AND um.created_at>=m.joined_at AND um.deleted_at IS NULL) AS unread_count,
    (SELECT body FROM messages x WHERE x.id=c.last_message_id AND x.deleted_at IS NULL) AS last_message_body,
    (SELECT created_at FROM messages x WHERE x.id=c.last_message_id) AS last_message_at
    FROM conversations c JOIN conversation_members m ON m.conversation_id=c.id
    WHERE m.user_id=? AND m.archived_at IS NULL ORDER BY c.updated_at DESC`).all(auth.user_id,auth.user_id,auth.user_id,auth.user_id);
 });
 app.get("/api/conversations/:id/members",async(request,reply)=>{
  const auth=await authenticate(request);if(!auth)return reply.code(401).send({error:"unauthorized"});
  const id=Number((request.params as {id:string}).id);if(!Number.isSafeInteger(id)||id<=0)return reply.code(400).send({error:"invalid_id"});
  if(!db.prepare("SELECT 1 FROM conversation_members WHERE conversation_id=? AND user_id=?").get(id,auth.user_id))return reply.code(404).send({error:"conversation_not_found"});
  return db.prepare("SELECT u.id,u.username,u.display_name,CASE WHEN u.avatar_attachment_id IS NULL THEN NULL ELSE '/api/media/'||u.avatar_attachment_id END AS avatar_url,m.role,m.joined_at,m.last_seen_at,m.last_delivered_id,m.last_read_id FROM conversation_members m JOIN users u ON u.id=m.user_id WHERE m.conversation_id=? ORDER BY m.joined_at").all(id);
 });
 app.post("/api/conversations/:id/mute",async(request,reply)=>{
  const auth=await authenticate(request);if(!auth)return reply.code(401).send({error:"unauthorized"});
  const cid=Number((request.params as {id:string}).id),body=request.body as {muted?:boolean};
  if(!Number.isSafeInteger(cid)||cid<=0||typeof body?.muted!=="boolean")return reply.code(400).send({error:"invalid_input"});
  const result=db.prepare("UPDATE conversation_members SET muted=? WHERE conversation_id=? AND user_id=?").run(body.muted?1:0,cid,auth.user_id);
  if(!result.changes)return reply.code(404).send({error:"conversation_not_found"});return {muted:body.muted};
 });
 app.post("/api/conversations/:id/archive",async(request,reply)=>{
  const auth=await authenticate(request);if(!auth)return reply.code(401).send({error:"unauthorized"});
  const cid=Number((request.params as {id:string}).id),body=request.body as {archived?:boolean};
  if(!Number.isSafeInteger(cid)||cid<=0||typeof body?.archived!=="boolean")return reply.code(400).send({error:"invalid_input"});
  const result=db.prepare("UPDATE conversation_members SET archived_at=? WHERE conversation_id=? AND user_id=?").run(body.archived?new Date().toISOString():null,cid,auth.user_id);
  if(!result.changes)return reply.code(404).send({error:"conversation_not_found"});return {archived:body.archived};
 });
 app.get("/api/conversations/:id/pin",async(request,reply)=>{
  const auth=await authenticate(request);if(!auth)return reply.code(401).send({error:"unauthorized"});
  const cid=Number((request.params as {id:string}).id);if(!Number.isSafeInteger(cid)||cid<=0)return reply.code(400).send({error:"invalid_id"});
  if(!db.prepare("SELECT 1 FROM conversation_members WHERE conversation_id=? AND user_id=?").get(cid,auth.user_id))return reply.code(404).send({error:"conversation_not_found"});
  const row=db.prepare("SELECT m.*,a.id AS attachment_id,a.mime AS attachment_mime,a.size AS attachment_size,a.width AS attachment_width,a.height AS attachment_height,a.duration_ms AS attachment_duration FROM conversation_pins p JOIN messages m ON m.id=p.message_id LEFT JOIN attachments a ON a.id=m.attachment_id WHERE p.conversation_id=?").get(cid) as Record<string,unknown>|undefined;
  if(!row)return {message:null};
  const attachmentId=row.attachment_id as number|undefined;
  const reactions=db.prepare("SELECT user_id,emoji FROM reactions WHERE message_id=?").all(Number(row.id));
  const message={...row,reactions,...(attachmentId?{attachment:{id:attachmentId,mime:row.attachment_mime,size:row.attachment_size,width:row.attachment_width??null,height:row.attachment_height??null,duration_ms:row.attachment_duration??null,url:"/api/media/"+attachmentId}}:{})};
  return {message};
 });
 app.post("/api/conversations/:id/pin",async(request,reply)=>{
  const auth=await authenticate(request);if(!auth)return reply.code(401).send({error:"unauthorized"});
  const cid=Number((request.params as {id:string}).id),body=request.body as {message_id?:number};
  if(!Number.isSafeInteger(cid)||cid<=0||!Number.isSafeInteger(body?.message_id)||Number(body.message_id)<=0)return reply.code(400).send({error:"invalid_input"});
  if(!db.prepare("SELECT 1 FROM conversation_members WHERE conversation_id=? AND user_id=?").get(cid,auth.user_id))return reply.code(404).send({error:"conversation_not_found"});
  if(!db.prepare("SELECT 1 FROM messages WHERE id=? AND conversation_id=? AND deleted_at IS NULL").get(body.message_id,cid))return reply.code(404).send({error:"message_not_found"});
  db.prepare("INSERT INTO conversation_pins(conversation_id,message_id,pinned_by) VALUES(?,?,?) ON CONFLICT(conversation_id) DO UPDATE SET message_id=excluded.message_id,pinned_by=excluded.pinned_by,pinned_at=datetime('now')").run(cid,body.message_id,auth.user_id);return {ok:true};
 });
 app.delete("/api/conversations/:id/pin",async(request,reply)=>{
  const auth=await authenticate(request);if(!auth)return reply.code(401).send({error:"unauthorized"});
  const cid=Number((request.params as {id:string}).id);if(!Number.isSafeInteger(cid)||cid<=0)return reply.code(400).send({error:"invalid_id"});
  if(!db.prepare("SELECT 1 FROM conversation_members WHERE conversation_id=? AND user_id=?").get(cid,auth.user_id))return reply.code(404).send({error:"conversation_not_found"});
  db.prepare("DELETE FROM conversation_pins WHERE conversation_id=?").run(cid);return {ok:true};
 });
 app.post("/api/conversations/direct",async(request,reply)=>{
  const auth=await authenticate(request);if(!auth)return reply.code(401).send({error:"unauthorized"});
  const parsed=directSchema.safeParse(request.body);if(!parsed.success||parsed.data.user_id===auth.user_id)return reply.code(400).send({error:"invalid_input"});
  if(!db.prepare("SELECT id FROM users WHERE id=?").get(parsed.data.user_id))return reply.code(404).send({error:"user_not_found"});
  const pair=[auth.user_id,parsed.data.user_id].sort((a,b)=>a-b);const key=pair.join(":");
  const existing=db.prepare("SELECT id FROM conversations WHERE direct_key=?").get(key) as {id:number}|undefined;if(existing){db.prepare("UPDATE conversation_members SET archived_at=NULL WHERE conversation_id=? AND user_id=?").run(existing.id,auth.user_id);return {id:existing.id,created:false};}
  const create=db.transaction(()=>{const row=db.prepare("INSERT INTO conversations(type,created_by,direct_key) VALUES('direct',?,?)").run(auth.user_id,key);const cid=Number(row.lastInsertRowid);const add=db.prepare("INSERT INTO conversation_members(conversation_id,user_id,role) VALUES(?,?,?)");add.run(cid,auth.user_id,"member");add.run(cid,parsed.data.user_id,"member");return cid;});
  try{return reply.code(201).send({id:create(),created:true});}catch{const raced=db.prepare("SELECT id FROM conversations WHERE direct_key=?").get(key) as {id:number}|undefined;if(raced)return {id:raced.id,created:false};throw new Error("direct_create_failed");}
 });
 app.post("/api/conversations/group",async(request,reply)=>{
  const auth=await authenticate(request);if(!auth)return reply.code(401).send({error:"unauthorized"});
  const parsed=groupSchema.safeParse(request.body);if(!parsed.success)return reply.code(400).send({error:"invalid_input"});
  const ids=[...new Set([...parsed.data.member_ids.filter(id=>id!==auth.user_id),auth.user_id])];if(ids.length<3)return reply.code(400).send({error:"group_requires_three_members"});
  const users=db.prepare("SELECT id FROM users WHERE id IN ("+ids.map(()=>"?").join(",")+")").all(...ids) as {id:number}[];if(users.length!==ids.length)return reply.code(400).send({error:"unknown_member"});
  const create=db.transaction(()=>{const row=db.prepare("INSERT INTO conversations(type,title,created_by) VALUES('group',?,?)").run(parsed.data.title,auth.user_id);const cid=Number(row.lastInsertRowid);const add=db.prepare("INSERT INTO conversation_members(conversation_id,user_id,role) VALUES(?,?,?)");for(const id of ids)add.run(cid,id,id===auth.user_id?"owner":"member");return cid;});
  return reply.code(201).send({id:create(),created:true});
 });
}
