import argon2 from "argon2";
export async function hashPassword(password: string) {
  return argon2.hash(password, { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 });
}
export async function verifyPassword(hash: string, password: string) {
  try { return await argon2.verify(hash, password); } catch { return false; }
}
export function validPassword(password: string) {
  return password.length >= 12 && password.length <= 128;
}
