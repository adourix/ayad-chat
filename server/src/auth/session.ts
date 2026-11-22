import { createHash, randomBytes, randomUUID } from "node:crypto";
import { config } from "../config.js";
import { db } from "../db/client.js";
export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");
export function createSession(userId: number, deviceLabel?: string) {
  const token = randomBytes(32).toString("base64url");
  const now = new Date();
  const expires = new Date(now.getTime() + config.SESSION_TTL_DAYS * 86400_000);
  db.prepare("INSERT INTO sessions(id,user_id,token_hash,device_label,expires_at) VALUES(?,?,?,?,?)")
    .run(randomUUID(), userId, hashToken(token), deviceLabel?.slice(0,120) ?? null, expires.toISOString());
  return { token, expires };
}
export function findSession(token: string) {
  return db.prepare(`SELECT s.id AS session_id, s.user_id, s.expires_at, u.username, u.display_name
    FROM sessions s JOIN users u ON u.id=s.user_id
    WHERE s.token_hash=? AND s.revoked_at IS NULL AND s.expires_at > ?`).get(hashToken(token), new Date().toISOString()) as
    {session_id:string;user_id:number;expires_at:string;username:string;display_name:string} | undefined;
}
export function touchSession(sessionId: string) {
  db.prepare("UPDATE sessions SET last_seen_at=?, expires_at=? WHERE id=?").run(new Date().toISOString(), new Date(Date.now() + config.SESSION_TTL_DAYS * 86400_000).toISOString(), sessionId);
}
export function revokeSession(sessionId: string) {
  db.prepare("UPDATE sessions SET revoked_at=? WHERE id=? AND revoked_at IS NULL").run(new Date().toISOString(), sessionId);
}

export function cleanupSessions(){db.prepare("DELETE FROM sessions WHERE expires_at<=? OR (revoked_at IS NOT NULL AND revoked_at<?)").run(new Date().toISOString(),new Date(Date.now()-30*86400_000).toISOString());}
