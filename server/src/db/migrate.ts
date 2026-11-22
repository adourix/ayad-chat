import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { db } from "./client.js";

const schemaPath = fileURLToPath(new URL("./schema.sql", import.meta.url));
const schema = readFileSync(schemaPath, "utf8");
db.exec(schema);
