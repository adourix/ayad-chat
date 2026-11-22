import type {FastifyInstance} from "fastify";
import {z} from "zod";
import {config} from "../config.js";
import {db} from "../db/client.js";
import {authenticate} from "../auth/guards.js";
import {createSession,revokeSession} from "../auth/session.js";
import {hashPassword,verifyPassword} from "../auth/password.js";
const loginSchema=z.object({username:z.string().trim().min(1).max(32),password:z.string().min(1).max(128),device_label:z.string().trim().max(120).optional()});
const dummyHash=await hashPassword("duet-login-timing-dummy-not-a-user-password");
export async function registerAuthRoutes(app:FastifyInstance){
 app.post("/api/auth/login",{config:{rateLimit:{max:8,timeWindow:"10 minutes"}}},async(request,reply)=>{
  const parsed=loginSchema.safeParse(request.body);if(!parsed.success)return reply.code(400).send({error:"invalid_input"});
  const {username,password,device_label}=parsed.data;
  const user=db.prepare("SELECT id,username,display_name,password_hash,avatar_attachment_id FROM users WHERE username=? COLLATE NOCASE").get(username) as {id:number;username:string;display_name:string;password_hash:string;avatar_attachment_id:number|null}|undefined;
  const verified=await verifyPassword(user?.password_hash??dummyHash,password);
  if(!user||!verified)return reply.code(401).send({error:"invalid_credentials"});
  const session=createSession(user.id,device_label);
  reply.setCookie(config.SESSION_COOKIE_NAME,session.token,{path:"/",httpOnly:true,secure:true,sameSite:"strict",expires:session.expires});
  return {user:{id:user.id,username:user.username,display_name:user.display_name,avatar_url:user.avatar_attachment_id?"/api/media/"+user.avatar_attachment_id:null}};
 });
 app.post("/api/auth/logout",async(request,reply)=>{const session=await authenticate(request);if(session)revokeSession(session.session_id);reply.clearCookie(config.SESSION_COOKIE_NAME,{path:"/",secure:true,httpOnly:true,sameSite:"strict"});return {ok:true};});
 app.get("/api/auth/me",async(request,reply)=>{const session=await authenticate(request);if(!session)return reply.code(401).send({error:"unauthorized"});const row=db.prepare("SELECT avatar_attachment_id FROM users WHERE id=?").get(session.user_id) as {avatar_attachment_id:number|null};return {user:{id:session.user_id,username:session.username,display_name:session.display_name,avatar_url:row.avatar_attachment_id?"/api/media/"+row.avatar_attachment_id:null}};});
}
