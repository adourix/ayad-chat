import {WebSocketServer,WebSocket} from "ws";
import type {FastifyInstance} from "fastify";
import {config} from "../config.js";
import {db} from "../db/client.js";
import {findSession} from "../auth/session.js";
import {currentRevision,nextRevision} from "../db/revision.js";
import {clientEnvelopeSchema} from "@duet/shared";
type Session=NonNullable<ReturnType<typeof findSession>>;
type Client={socket:WebSocket;userId:number;sessionId:string;subscribed:Set<number>};
const clients=new Set<Client>();
const send=(client:Client,payload:unknown)=>{if(client.socket.readyState===WebSocket.OPEN)client.socket.send(JSON.stringify(payload));};
const member=(cid:number,uid:number)=>db.prepare("SELECT joined_at,last_read_id,last_delivered_id FROM conversation_members WHERE conversation_id=? AND user_id=?").get(cid,uid) as {joined_at:string;last_read_id:number;last_delivered_id:number}|undefined;
const broadcastConversation=(cid:number,payload:unknown,except?:Client)=>{for(const c of clients)if(c!==except&&member(cid,c.userId))send(c,payload);};
const broadcastUser=(uid:number,payload:unknown,except?:Client)=>{for(const c of clients)if(c!==except&&c.userId===uid)send(c,payload);};
const userOnline=(uid:number)=>[...clients].some(c=>c.userId===uid);
const sessionActive=(sid:string)=>Boolean(db.prepare("SELECT 1 FROM sessions WHERE id=? AND revoked_at IS NULL AND expires_at>?").get(sid,new Date().toISOString()));
function presence(uid:number,online:boolean,lastSeen:string|null){
 const rows=db.prepare("SELECT conversation_id FROM conversation_members WHERE user_id=?").all(uid) as {conversation_id:number}[];
 for(const row of rows)broadcastConversation(row.conversation_id,{t:"presence",user_id:uid,online,last_seen_at:lastSeen});
}
function parseCookie(raw:string|undefined,name:string){if(!raw)return;for(const item of raw.split(";")){const [key,...rest]=item.trim().split("=");if(key===name)return rest.join("=");}}
function messageRecord(id:number){
 return db.prepare(`SELECT m.id,m.client_id,m.conversation_id,m.sender_id,m.kind,m.body,m.body_format,m.reply_to_id,m.created_at,m.edited_at,m.deleted_at,m.rev,
  a.id AS attachment_id,a.mime AS attachment_mime,a.size AS attachment_size,a.width AS attachment_width,a.height AS attachment_height,a.duration_ms AS attachment_duration
  FROM messages m LEFT JOIN attachments a ON a.id=m.attachment_id WHERE m.id=?`).get(id) as Record<string,unknown>|undefined;
}
function hydrate(record:Record<string,unknown>|undefined){
 if(!record)return record;
 const id=Number(record.id);const reactions=db.prepare("SELECT user_id,emoji FROM reactions WHERE message_id=? ORDER BY emoji").all(id) as {user_id:number;emoji:string}[];
 const base={...record,reactions};const attachmentId=record.attachment_id as number|undefined;
 if(!attachmentId)return base;
 return {...base,attachment:{id:attachmentId,mime:record.attachment_mime,size:record.attachment_size,width:record.attachment_width??null,height:record.attachment_height??null,duration_ms:record.attachment_duration??null,url:`/api/media/${attachmentId}`}};
}
export function attachWebSocket(app:FastifyInstance){
 const wss=new WebSocketServer({noServer:true,maxPayload:16*1024});const sessionSweep=setInterval(()=>{for(const client of clients)if(!sessionActive(client.sessionId))client.socket.close(1008,"session expired");},60_000);sessionSweep.unref();
 app.server.on("upgrade",(req,socket,head)=>{
  const origin=req.headers.origin;if(!origin||!config.allowedOrigins.has(origin)){socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");socket.destroy();return;}
  const token=parseCookie(req.headers.cookie,config.SESSION_COOKIE_NAME);const session=token?findSession(token):undefined;
  if(!session){socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");socket.destroy();return;}
  (req as typeof req & {duetSession?:Session}).duetSession=session;
  wss.handleUpgrade(req,socket,head,ws=>wss.emit("connection",ws,req));
 });
 wss.on("connection",(socket,req)=>{
  const session=(req as typeof req & {duetSession?:Session}).duetSession;if(!session){socket.close(1008,"unauthorized");return;}
  const wasOnline=userOnline(session.user_id);
  const client:Client={socket,userId:session.user_id,sessionId:session.session_id,subscribed:new Set()};clients.add(client);
  const now=new Date().toISOString();
  db.prepare("UPDATE conversation_members SET last_seen_at=? WHERE user_id=?").run(now,client.userId);
  if(!wasOnline)presence(client.userId,true,now);
  socket.on("message",raw=>{
   let payload:unknown;try{payload=JSON.parse(raw.toString());}catch{send(client,{t:"error",code:"invalid_json"});return;}
   const parsed=clientEnvelopeSchema.safeParse(payload);if(!parsed.success){send(client,{t:"error",code:"invalid_envelope"});return;}
   const msg=parsed.data;
   if(msg.t==="ping"){send(client,{t:"pong"});return;}
   if(msg.t==="hello"){
    const conv=db.prepare("SELECT c.id,c.type,c.title,c.updated_at,c.last_message_id,m.role,m.joined_at,m.last_read_id,m.last_delivered_id FROM conversations c JOIN conversation_members m ON m.conversation_id=c.id WHERE m.user_id=? AND m.archived_at IS NULL ORDER BY c.updated_at DESC").all(client.userId);
    const peers=db.prepare("SELECT DISTINCT u.id AS user_id, MAX(cm.last_seen_at) AS last_seen_at FROM users u JOIN conversation_members cm ON cm.user_id=u.id JOIN conversation_members mine ON mine.conversation_id=cm.conversation_id AND mine.user_id=? WHERE u.id<>? GROUP BY u.id").all(client.userId,client.userId) as {user_id:number;last_seen_at:string|null}[];
    const snapshot=peers.map(p=>({user_id:p.user_id,online:userOnline(p.user_id),last_seen_at:p.last_seen_at}));
    send(client,{t:"hello.ok",protocol:1,server_rev:currentRevision(),user:{id:session.user_id,username:session.username,display_name:session.display_name},conversations:conv,presence_snapshot:snapshot});
    const rows=db.prepare("SELECT messages.* FROM messages JOIN conversation_members cm ON cm.conversation_id=messages.conversation_id WHERE cm.user_id=? AND messages.rev>? AND messages.created_at>=cm.joined_at ORDER BY messages.rev LIMIT 500").all(client.userId,msg.since_rev);
    if(rows.length)send(client,{t:"sync.batch",messages:rows.map(row=>hydrate(row as Record<string,unknown>))});send(client,{t:"sync.done",server_rev:currentRevision()});return;
   }
   if(msg.t==="conversation.subscribe"){if(!member(msg.conversation_id,client.userId)){send(client,{t:"error",code:"forbidden"});return;}client.subscribed.add(msg.conversation_id);send(client,{t:"conversation.subscribed",conversation_id:msg.conversation_id});return;}
   if(msg.t==="conversation.unsubscribe"){client.subscribed.delete(msg.conversation_id);return;}
   if(msg.t==="receipt"){
    if(!member(msg.conversation_id,client.userId)){send(client,{t:"error",code:"forbidden"});return;}
    const maxRow=db.prepare("SELECT COALESCE(MAX(id),0) AS id FROM messages WHERE conversation_id=?").get(msg.conversation_id) as {id:number};
    const delivered=msg.delivered_up_to?Math.min(msg.delivered_up_to,maxRow.id):undefined,read=msg.read_up_to?Math.min(msg.read_up_to,maxRow.id):undefined;
    if(delivered){db.prepare("UPDATE conversation_members SET last_delivered_id=MAX(last_delivered_id,?) WHERE conversation_id=? AND user_id=?").run(delivered,msg.conversation_id,client.userId);}
    if(read){db.prepare("UPDATE conversation_members SET last_read_id=MAX(last_read_id,?) WHERE conversation_id=? AND user_id=?").run(read,msg.conversation_id,client.userId);}
    broadcastConversation(msg.conversation_id,{t:"receipt",conversation_id:msg.conversation_id,user_id:client.userId,delivered_up_to:delivered,read_up_to:read});
    return;
   }
   if(msg.t==="typing"){if(!member(msg.conversation_id,client.userId)){send(client,{t:"error",code:"forbidden"});return;}broadcastConversation(msg.conversation_id,{t:"typing",conversation_id:msg.conversation_id,user_id:client.userId,on:msg.on},client);return;}
   if(msg.t==="msg.edit"){
    const membership=member(msg.conversation_id,client.userId);if(!membership){send(client,{t:"error",code:"forbidden"});return;}
    const target=db.prepare("SELECT id,sender_id,created_at,deleted_at FROM messages WHERE id=? AND conversation_id=?").get(msg.id,msg.conversation_id) as {id:number;sender_id:number;created_at:string;deleted_at:string|null}|undefined;
    if(!target||target.sender_id!==client.userId||target.deleted_at){send(client,{t:"error",code:"cannot_edit"});return;}
    if(Date.now()-new Date(target.created_at).getTime()>15*60*1000){send(client,{t:"error",code:"edit_expired"});return;}
    const rev=nextRevision(),editedAt=new Date().toISOString();db.prepare("UPDATE messages SET body=?,edited_at=?,rev=? WHERE id=?").run(msg.body,editedAt,rev,msg.id);
    const record=hydrate(messageRecord(msg.id));broadcastConversation(msg.conversation_id,{t:"msg.update",message:record});return;
   }
   if(msg.t==="msg.delete"){
    const membership=member(msg.conversation_id,client.userId);if(!membership){send(client,{t:"error",code:"forbidden"});return;}
    const target=db.prepare("SELECT id,sender_id,deleted_at FROM messages WHERE id=? AND conversation_id=?").get(msg.id,msg.conversation_id) as {id:number;sender_id:number;deleted_at:string|null}|undefined;
    if(!target||target.sender_id!==client.userId||target.deleted_at){send(client,{t:"error",code:"cannot_delete"});return;}
    const rev=nextRevision(),deletedAt=new Date().toISOString();db.prepare("UPDATE messages SET body='',deleted_at=?,rev=? WHERE id=?").run(deletedAt,rev,msg.id);
    const record=hydrate(messageRecord(msg.id));broadcastConversation(msg.conversation_id,{t:"msg.update",message:record});return;
   }
   if(msg.t==="react"){
    if(!member(msg.conversation_id,client.userId)){send(client,{t:"error",code:"forbidden"});return;}
    const target=db.prepare("SELECT id FROM messages WHERE id=? AND conversation_id=? AND deleted_at IS NULL").get(msg.id,msg.conversation_id);if(!target){send(client,{t:"error",code:"message_not_found"});return;}
    db.prepare("DELETE FROM reactions WHERE message_id=? AND user_id=?").run(msg.id,client.userId);if(msg.emoji)db.prepare("INSERT OR IGNORE INTO reactions(message_id,user_id,emoji) VALUES(?,?,?)").run(msg.id,client.userId,msg.emoji);
    const record=hydrate(messageRecord(msg.id));broadcastConversation(msg.conversation_id,{t:"msg.update",message:record});return;
   }
   if(msg.t==="msg.send"){
    const membership=member(msg.conversation_id,client.userId);if(!membership){send(client,{t:"error",code:"forbidden",ref:msg.client_id});return;}
    if(msg.reply_to&&!db.prepare("SELECT id FROM messages WHERE id=? AND conversation_id=?").get(msg.reply_to,msg.conversation_id)){send(client,{t:"error",code:"invalid_reply",ref:msg.client_id});return;}
    if(msg.kind!=="text"&&(!msg.attachment_id||!db.prepare("SELECT id FROM attachments WHERE id=? AND uploader_id=?").get(msg.attachment_id,client.userId))){send(client,{t:"error",code:"invalid_attachment",ref:msg.client_id});return;}
    const duplicate=db.prepare("SELECT id,created_at,rev FROM messages WHERE conversation_id=? AND sender_id=? AND client_id=?").get(msg.conversation_id,client.userId,msg.client_id) as {id:number;created_at:string;rev:number}|undefined;
    if(duplicate){send(client,{t:"msg.ack",client_id:msg.client_id,id:duplicate.id,created_at:duplicate.created_at,rev:duplicate.rev});return;}
    const transaction=db.transaction(()=>{const rev=nextRevision();const inserted=db.prepare("INSERT INTO messages(conversation_id,sender_id,client_id,kind,body,body_format,reply_to_id,attachment_id,rev) VALUES(?,?,?,?,?,0,?,?,?)").run(msg.conversation_id,client.userId,msg.client_id,msg.kind,msg.body,msg.reply_to??null,msg.attachment_id??null,rev);const id=Number(inserted.lastInsertRowid);const created=db.prepare("SELECT created_at FROM messages WHERE id=?").get(id) as {created_at:string};db.prepare("UPDATE conversations SET updated_at=?,last_message_id=? WHERE id=?").run(created.created_at,id,msg.conversation_id);return{id,rev,created_at:created.created_at};});
    const result=transaction();send(client,{t:"msg.ack",client_id:msg.client_id,id:result.id,created_at:result.created_at,rev:result.rev});
    const record=hydrate(messageRecord(result.id));
    broadcastConversation(msg.conversation_id,{t:"msg.new",message:record},client);broadcastUser(client.userId,{t:"msg.new",message:record},client);
    const recipients=db.prepare("SELECT user_id FROM conversation_members WHERE conversation_id=? AND user_id<>?").all(msg.conversation_id,client.userId) as {user_id:number}[];
    for(const recipient of recipients)if(userOnline(recipient.user_id)){
     db.prepare("UPDATE conversation_members SET last_delivered_id=MAX(last_delivered_id,?) WHERE conversation_id=? AND user_id=?").run(result.id,msg.conversation_id,recipient.user_id);
     broadcastConversation(msg.conversation_id,{t:"receipt",conversation_id:msg.conversation_id,user_id:recipient.user_id,delivered_up_to:result.id});
    }
   }
  });
  socket.on("close",()=>{
   clients.delete(client);
   if(!userOnline(client.userId)){const seenAt=new Date().toISOString();db.prepare("UPDATE conversation_members SET last_seen_at=? WHERE user_id=?").run(seenAt,client.userId);presence(client.userId,false,seenAt);}
  });
  socket.on("error",()=>clients.delete(client));
 });
 app.addHook("onClose",async()=>{clearInterval(sessionSweep);for(const c of clients)c.socket.close(1001,"Server shutdown");wss.close();});
}
