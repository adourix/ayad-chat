import { WebSocketServer, WebSocket } from "ws";
import type { FastifyInstance } from "fastify";
import { config } from "../config.js";
import { db } from "../db/client.js";
import { findSession } from "../auth/session.js";
import { currentRevision, nextRevision } from "../db/revision.js";
import { clientEnvelopeSchema } from "@duet/shared";

type Client = { socket: WebSocket; userId: number; sessionId: string; subscribed: Set<number> };
const clients = new Set<Client>();
const send = (client: Client, payload: unknown) => { if (client.socket.readyState === WebSocket.OPEN) client.socket.send(JSON.stringify(payload)); };
const member = (conversationId: number, userId: number) => db.prepare("SELECT joined_at FROM conversation_members WHERE conversation_id=? AND user_id=?").get(conversationId,userId) as {joined_at:string}|undefined;
const broadcastConversation = (conversationId:number, payload:unknown, except?:Client) => {
  for (const c of clients) if (c!==except && c.subscribed.has(conversationId) && member(conversationId,c.userId)) send(c,payload);
};
const broadcastUser = (userId:number,payload:unknown,except?:Client) => { for(const c of clients) if(c!==except && c.userId===userId) send(c,payload); };
function parseCookie(raw:string|undefined,name:string) {
  if(!raw) return undefined;
  for(const item of raw.split(";")) { const [key,...rest]=item.trim().split("="); if(key===name) return rest.join("="); }
  return undefined;
}
export function attachWebSocket(app:FastifyInstance) {
  const wss=new WebSocketServer({noServer:true,maxPayload:16*1024});
  app.server.on("upgrade",(req,socket,head)=>{
    const origin=req.headers.origin;
    if(!origin || !config.allowedOrigins.has(origin)) { socket.write("HTTP/1.1 403 Forbidden\r\n\r\n"); socket.destroy(); return; }
    const token=parseCookie(req.headers.cookie,config.SESSION_COOKIE_NAME);
    const session=token ? findSession(token) : undefined;
    if(!session) { socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n"); socket.destroy(); return; }
    wss.handleUpgrade(req,socket,head,ws=>wss.emit("connection",ws,req,session));
  });
  wss.on("connection",(socket,req,session:any)=>{
    const client:Client={socket,userId:session.user_id,sessionId:session.session_id,subscribed:new Set()};
    clients.add(client);
    socket.on("message",raw=>{
      let parsed:unknown;
      try { parsed=JSON.parse(raw.toString()); } catch { send(client,{t:"error",code:"invalid_json"}); return; }
      const envelope=clientEnvelopeSchema.safeParse(parsed);
      if(!envelope.success) { send(client,{t:"error",code:"invalid_envelope"}); return; }
      const msg=envelope.data;
      if(msg.t==="ping") { send(client,{t:"pong"}); return; }
      if(msg.t==="hello") {
        const conv=db.prepare("SELECT c.id,c.type,c.title,c.updated_at,c.last_message_id,m.role,m.joined_at,m.last_read_id,m.last_delivered_id FROM conversations c JOIN conversation_members m ON m.conversation_id=c.id WHERE m.user_id=? AND m.archived_at IS NULL ORDER BY c.updated_at DESC").all(client.userId);
        send(client,{t:"hello.ok",protocol:1,server_rev:currentRevision(),user:{id:session.user_id,username:session.username,display_name:session.display_name},conversations:conv});
        const since=msg.since_rev;
        const rows=db.prepare("SELECT messages.* FROM messages JOIN conversation_members cm ON cm.conversation_id=messages.conversation_id WHERE cm.user_id=? AND messages.rev>? AND messages.created_at>=cm.joined_at ORDER BY messages.rev LIMIT 500").all(client.userId,since);
        if(rows.length) send(client,{t:"sync.batch",messages:rows});
        send(client,{t:"sync.done",server_rev:currentRevision()});
        return;
      }
      if(msg.t==="conversation.subscribe") {
        if(!member(msg.conversation_id,client.userId)) { send(client,{t:"error",code:"forbidden"}); return; }
        client.subscribed.add(msg.conversation_id); send(client,{t:"conversation.subscribed",conversation_id:msg.conversation_id}); return;
      }
      if(msg.t==="conversation.unsubscribe") { client.subscribed.delete(msg.conversation_id); return; }
      if(msg.t==="msg.send") {
        const membership=member(msg.conversation_id,client.userId);
        if(!membership) { send(client,{t:"error",code:"forbidden",ref:msg.client_id}); return; }
        const duplicate=db.prepare("SELECT id,created_at,rev FROM messages WHERE conversation_id=? AND sender_id=? AND client_id=?").get(msg.conversation_id,client.userId,msg.client_id) as {id:number;created_at:string;rev:number}|undefined;
        if(duplicate) { send(client,{t:"msg.ack",client_id:msg.client_id,id:duplicate.id,created_at:duplicate.created_at,rev:duplicate.rev}); return; }
        const transaction=db.transaction(()=>{
          const rev=nextRevision();
          const inserted=db.prepare("INSERT INTO messages(conversation_id,sender_id,client_id,kind,body,body_format,rev) VALUES(?,?,?,'text',?,0,?)").run(msg.conversation_id,client.userId,msg.client_id,msg.body,rev);
          const id=Number(inserted.lastInsertRowid);
          const created=db.prepare("SELECT created_at FROM messages WHERE id=?").get(id) as {created_at:string};
          db.prepare("UPDATE conversations SET updated_at=?,last_message_id=? WHERE id=?").run(created.created_at,id,msg.conversation_id);
          return {id,rev,created_at:created.created_at};
        });
        const result=transaction();
        send(client,{t:"msg.ack",client_id:msg.client_id,id:result.id,created_at:result.created_at,rev:result.rev});
        const record=db.prepare("SELECT id,client_id,conversation_id,sender_id,kind,body,body_format,reply_to_id,created_at,edited_at,deleted_at,rev FROM messages WHERE id=?").get(result.id);
        broadcastConversation(msg.conversation_id,{t:"msg.new",message:record},client);
        broadcastUser(client.userId,{t:"msg.new",message:record},client);
        return;
      }
    });
    socket.on("close",()=>clients.delete(client));
    socket.on("error",()=>clients.delete(client));
  });
  app.addHook("onClose",async()=>{for(const c of clients)c.socket.close(1001,"Server shutting down");wss.close();});
}
