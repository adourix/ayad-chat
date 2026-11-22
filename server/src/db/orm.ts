import {drizzle} from "drizzle-orm/better-sqlite3";
import {db} from "./client.js";
import * as schema from "./schema.js";
export const orm=drizzle(db,{schema});
