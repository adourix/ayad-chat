import type { FastifyRequest } from "fastify";
import { config } from "../config.js";
import { findSession, touchSession } from "./session.js";
export type AuthUser = { session_id:string; user_id:number; username:string; display_name:string; expires_at:string };
declare module "fastify" {
  interface FastifyRequest { authUser?: AuthUser }
}
export function readToken(request: FastifyRequest) {
  return request.cookies[config.SESSION_COOKIE_NAME];
}
export async function authenticate(request: FastifyRequest) {
  const token = readToken(request);
  if (!token) return null;
  const session = findSession(token);
  if (!session) return null;
  touchSession(session.session_id);
  request.authUser = session;
  return session;
}
