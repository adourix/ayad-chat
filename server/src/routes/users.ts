import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {mkdir,writeFile,unlink} from "node:fs/promises";
import {randomUUID} from "node:crypto";
import {dirname,join,resolve} from "node:path";
import { db } from "../db/client.js";
import { authenticate } from "../auth/guards.js";
import { hashPassword, verifyPassword, validPassword } from "../auth/password.js";

const avatarTypes=new Map([["image/jpeg","jpg"],["image/png","png"],["image/webp","webp"]]);
const avatarDir=resolve(dirname(resolve(process.env.DATABASE_PATH||"./data/duet.db")),"media");
const accountSchema = z.object({
  username: z.string().trim().min(3).max(32).regex(/^[a-zA-Z0-9_.-]+$/),
  display_name: z.string().trim().min(1).max(80),
});
const passwordSchema = z.object({
  current_password: z.string().min(1).max(128),
  new_password: z.string().min(8).max(128),
});

export async function registerUserRoutes(app: FastifyInstance) {
  app.get("/api/users", async (request, reply) => {
    const auth = await authenticate(request);
    if (!auth) return reply.code(401).send({ error: "unauthorized" });
    const q = ((request.query as { q?: string }).q ?? "").trim().slice(0, 40);
    if (!q) return { users: [] };
    return {
      users: db.prepare("SELECT id,username,display_name,CASE WHEN avatar_attachment_id IS NULL THEN NULL ELSE '/api/media/'||avatar_attachment_id END AS avatar_url FROM users WHERE id<>? AND (username LIKE ? OR display_name LIKE ?) ORDER BY display_name LIMIT 20")
        .all(auth.user_id, `%${q}%`, `%${q}%`),
    };
  });

  app.post("/api/users/me/avatar",async(request,reply)=>{
    const auth=await authenticate(request);if(!auth)return reply.code(401).send({error:"unauthorized"});
    const raw=request.headers["x-media-type"];const mime=typeof raw==="string"?raw.toLowerCase():"";const ext=avatarTypes.get(mime);if(!ext)return reply.code(415).send({error:"unsupported_media_type"});
    const buffer=request.body as Buffer;if(!Buffer.isBuffer(buffer)||buffer.length===0)return reply.code(400).send({error:"empty_media"});if(buffer.length>5*1024*1024)return reply.code(413).send({error:"media_too_large"});
    await mkdir(avatarDir,{recursive:true});const key=randomUUID()+"."+ext;const file=join(avatarDir,key);try{await writeFile(file,buffer,{flag:"wx"});const inserted=db.prepare("INSERT INTO attachments(uploader_id,mime,size,storage_key) VALUES(?,?,?,?)").run(auth.user_id,mime,buffer.length,key);const id=Number(inserted.lastInsertRowid);db.prepare("UPDATE users SET avatar_attachment_id=? WHERE id=?").run(id,auth.user_id);return {avatar_url:"/api/media/"+id};}catch(error){await unlink(file).catch(()=>{});throw error;}
  });
  app.patch("/api/users/me", async (request, reply) => {
    const auth = await authenticate(request);
    if (!auth) return reply.code(401).send({ error: "unauthorized" });
    const parsed = accountSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_input" });
    const { username, display_name } = parsed.data;
    const existing = db.prepare("SELECT id FROM users WHERE username=? COLLATE NOCASE AND id<>?").get(username, auth.user_id);
    if (existing) return reply.code(409).send({ error: "username_taken" });
    db.prepare("UPDATE users SET username=?,display_name=? WHERE id=?").run(username, display_name, auth.user_id);
    const avatar=db.prepare("SELECT avatar_attachment_id FROM users WHERE id=?").get(auth.user_id) as {avatar_attachment_id:number|null};return { user: { id: auth.user_id, username, display_name, avatar_url:avatar.avatar_attachment_id?"/api/media/"+avatar.avatar_attachment_id:null } };
  });

  app.post("/api/users/me/password", async (request, reply) => {
    const auth = await authenticate(request);
    if (!auth) return reply.code(401).send({ error: "unauthorized" });
    const parsed = passwordSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_input" });
    if (!validPassword(parsed.data.new_password)) return reply.code(400).send({ error: "invalid_input" });
    const row = db.prepare("SELECT password_hash FROM users WHERE id=?").get(auth.user_id) as { password_hash: string } | undefined;
    if (!row || !(await verifyPassword(row.password_hash, parsed.data.current_password))) return reply.code(401).send({ error: "current_password_incorrect" });
    const hash = await hashPassword(parsed.data.new_password);
    db.prepare("UPDATE users SET password_hash=? WHERE id=?").run(hash, auth.user_id);
    db.prepare("UPDATE sessions SET revoked_at=? WHERE user_id=? AND id<>? AND revoked_at IS NULL").run(new Date().toISOString(), auth.user_id, auth.session_id);
    return { ok: true };
  });
}
