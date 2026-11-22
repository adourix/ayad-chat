import { db } from "../db/client.js";
import "../db/migrate.js";
import { hashPassword, validPassword } from "../auth/password.js";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
const rl = createInterface({ input: stdin, output: stdout });
try {
  const username = (process.argv[2] ?? await rl.question("Username: ")).trim();
  const displayName = (process.argv[3] ?? await rl.question("Display name: ")).trim();
  const password = await rl.question("Password (12+ characters): ");
  if (!/^[a-zA-Z0-9_.-]{3,32}$/.test(username)) throw new Error("Username must be 3-32 characters (letters, numbers, _, ., -).");
  if (!displayName || displayName.length > 80) throw new Error("Display name is required and must be <= 80 characters.");
  if (!validPassword(password)) throw new Error("Password must be 12-128 characters.");
  const exists = db.prepare("SELECT 1 FROM users WHERE username=? COLLATE NOCASE").get(username);
  if (exists) throw new Error("Username already exists.");
  const hash = await hashPassword(password);
  const result = db.prepare("INSERT INTO users(username,display_name,password_hash) VALUES(?,?,?)").run(username, displayName, hash);
  console.log(`Created user #${result.lastInsertRowid}: ${username}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  rl.close();
  db.close();
}
