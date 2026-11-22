import type {FastifyInstance} from "fastify";
import {mkdir,stat,unlink,writeFile} from "node:fs/promises";
import {createReadStream} from "node:fs";
import {randomUUID} from "node:crypto";
import {dirname,join,resolve} from "node:path";
import {db} from "../db/client.js";
import {authenticate} from "../auth/guards.js";
const imageTypes=new Map([["image/jpeg","jpg"],["image/png","png"],["image/webp","webp"],["image/gif","gif"]]);
const videoTypes=new Map([["video/mp4","mp4"],["video/webm","webm"],["video/quicktime","mov"]]);
const imageMax=8*1024*1024,videoMax=24*1024*1024;
const mediaDir=resolve(dirname(resolve(process.env.DATABASE_PATH||"./data/duet.db")),"media");
async function pruneOrphanMedia(){
 const old=db.prepare("SELECT id,storage_key FROM attachments WHERE created_at<datetime('now','-1 day') AND NOT EXISTS(SELECT 1 FROM messages WHERE messages.attachment_id=attachments.id)").all() as {id:number;storage_key:string}[];
 for(const row of old){await unlink(join(mediaDir,row.storage_key)).catch(()=>{});db.prepare("DELETE FROM attachments WHERE id=?").run(row.id);}
}
export async function registerMediaRoutes(app:FastifyInstance){
 await mkdir(mediaDir,{recursive:true});await pruneOrphanMedia();
 const cleanupTimer=setInterval(()=>{void pruneOrphanMedia().catch(()=>{});},24*60*60*1000);cleanupTimer.unref();
 app.addHook("onClose",async()=>clearInterval(cleanupTimer));
 app.post("/api/media",async(request,reply)=>{
  const auth=await authenticate(request);if(!auth)return reply.code(401).send({error:"unauthorized"});
  const headerMime=request.headers["x-media-type"],contentTypeHeader=request.headers["content-type"];
  const rawMime=typeof headerMime==="string"?headerMime:typeof contentTypeHeader==="string"?contentTypeHeader:"";
  const mime=rawMime.split(";")[0].trim().toLowerCase();
  const ext=imageTypes.get(mime)||videoTypes.get(mime);if(!ext)return reply.code(415).send({error:"unsupported_media_type"});
  const max=imageTypes.has(mime)?imageMax:videoMax;
  const declared=Number(request.headers["content-length"]||0);if(declared>max)return reply.code(413).send({error:"media_too_large"});
  const buffer=request.body as Buffer;if(!Buffer.isBuffer(buffer)||buffer.length===0)return reply.code(400).send({error:"empty_media"});if(buffer.length>max)return reply.code(413).send({error:"media_too_large"});
  const width=Number(request.headers["x-media-width"]||0),height=Number(request.headers["x-media-height"]||0);const safeWidth=width>0&&width<=20000?width:null,safeHeight=height>0&&height<=20000?height:null;
  const key=randomUUID()+"."+ext,fullPath=join(mediaDir,key),size=buffer.length;
  try{
   await writeFile(fullPath,buffer,{flag:"wx"});
   const created=db.prepare("INSERT INTO attachments(uploader_id,mime,size,width,height,storage_key) VALUES(?,?,?,?,?,?)").run(auth.user_id,mime,size,safeWidth,safeHeight,key);
   const id=Number(created.lastInsertRowid);
   return reply.code(201).send({id,mime,size,url:"/api/media/"+id});
  }catch(error){await unlink(fullPath).catch(()=>{});throw error;}
 });
 app.get("/api/media/:id",async(request,reply)=>{
  const auth=await authenticate(request);if(!auth)return reply.code(401).send({error:"unauthorized"});
  const id=Number((request.params as {id:string}).id);if(!Number.isSafeInteger(id)||id<=0)return reply.code(400).send({error:"invalid_id"});
  const row=db.prepare("SELECT id,uploader_id,mime,size,storage_key FROM attachments WHERE id=?").get(id) as {id:number;uploader_id:number;mime:string;size:number;storage_key:string}|undefined;
  if(!row)return reply.code(404).send({error:"media_not_found"});
  const allowed=row.uploader_id===auth.user_id||Boolean(db.prepare("SELECT 1 FROM messages m JOIN conversation_members cm ON cm.conversation_id=m.conversation_id WHERE m.attachment_id=? AND cm.user_id=? LIMIT 1").get(id,auth.user_id));
  if(!allowed)return reply.code(403).send({error:"forbidden"});
  const path=join(mediaDir,row.storage_key);try{const s=await stat(path);reply.header("Content-Type",row.mime).header("Content-Length",s.size).header("Cache-Control","private, max-age=86400").header("X-Content-Type-Options","nosniff");return reply.send(createReadStream(path));}catch{return reply.code(404).send({error:"media_not_found"});}
 });
}
