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
function validSignature(buffer:Buffer,mime:string){if(mime==="image/jpeg")return buffer.length>=3&&buffer[0]===0xff&&buffer[1]===0xd8&&buffer[2]===0xff;if(mime==="image/png")return buffer.length>=8&&buffer.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));if(mime==="image/webp")return buffer.length>=12&&buffer.subarray(0,4).toString()==="RIFF"&&buffer.subarray(8,12).toString()==="WEBP";if(mime==="image/gif")return buffer.length>=6&&["GIF87a","GIF89a"].includes(buffer.subarray(0,6).toString());if(mime==="video/mp4"||mime==="video/quicktime")return buffer.length>=12&&buffer.subarray(4,8).toString()==="ftyp";if(mime==="video/webm")return buffer.length>=4&&buffer.subarray(0,4).equals(Buffer.from([0x1a,0x45,0xdf,0xa3]));return false;}
async function pruneOrphanMedia(){
 const old=db.prepare("SELECT id,storage_key FROM attachments WHERE created_at<datetime('now','-1 day') AND NOT EXISTS(SELECT 1 FROM messages WHERE messages.attachment_id=attachments.id) AND NOT EXISTS(SELECT 1 FROM users WHERE users.avatar_attachment_id=attachments.id)").all() as {id:number;storage_key:string}[];
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
  const mime=(rawMime.split(";")[0]?.trim().toLowerCase() ?? "");
  const ext=imageTypes.get(mime)||videoTypes.get(mime);if(!ext)return reply.code(415).send({error:"unsupported_media_type"});
  const max=imageTypes.has(mime)?imageMax:videoMax;
  const declared=Number(request.headers["content-length"]||0);if(declared>max)return reply.code(413).send({error:"media_too_large"});
  const buffer=request.body as Buffer;if(!Buffer.isBuffer(buffer)||buffer.length===0)return reply.code(400).send({error:"empty_media"});if(buffer.length>max)return reply.code(413).send({error:"media_too_large"});if(!validSignature(buffer,mime))return reply.code(415).send({error:"invalid_media_signature"});
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
  const allowed=row.uploader_id===auth.user_id||Boolean(db.prepare("SELECT 1 FROM users WHERE avatar_attachment_id=?").get(id))||Boolean(db.prepare("SELECT 1 FROM messages m JOIN conversation_members cm ON cm.conversation_id=m.conversation_id WHERE m.attachment_id=? AND cm.user_id=? LIMIT 1").get(id,auth.user_id));
  if(!allowed)return reply.code(403).send({error:"forbidden"});
  const path=join(mediaDir,row.storage_key);try{const s=await stat(path),range=request.headers.range;reply.header("Content-Type",row.mime).header("Accept-Ranges","bytes").header("Cache-Control","private, max-age=86400").header("X-Content-Type-Options","nosniff");if(range){const match=/^bytes=(\d*)-(\d*)$/.exec(range);if(!match)return reply.code(416).header("Content-Range","bytes */"+s.size).send();let start=match[1]?Number(match[1]):0,end=match[2]?Number(match[2]):s.size-1;if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||end>=s.size||start>end)return reply.code(416).header("Content-Range","bytes */"+s.size).send();reply.code(206).header("Content-Range","bytes "+start+"-"+end+"/"+s.size).header("Content-Length",end-start+1);return reply.send(createReadStream(path,{start,end}));}reply.header("Content-Length",s.size);return reply.send(createReadStream(path));}catch{return reply.code(404).send({error:"media_not_found"});}
 });
}
