import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { db } from "./client.js";

const schemaPath = fileURLToPath(new URL("./schema.sql", import.meta.url));
const schema = readFileSync(schemaPath, "utf8");
db.exec(schema);

// Backward-compatible additive migration for existing databases.
try{db.exec("ALTER TABLE users ADD COLUMN avatar_attachment_id INTEGER");}catch(error){if(!(error instanceof Error&&error.message.includes("duplicate column name")))throw error;}

try{db.exec("ALTER TABLE conversation_members ADD COLUMN clear_before_id INTEGER NOT NULL DEFAULT 0");}catch(error){if(!(error instanceof Error&&error.message.includes("duplicate column name")))throw error;}
