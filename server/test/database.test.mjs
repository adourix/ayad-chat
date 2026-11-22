import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
const schema=readFileSync(fileURLToPath(new URL("../src/db/schema.sql",import.meta.url)),"utf8");
function setup(){const db=new Database(":memory:");db.exec(schema);return db;}
test("database schema, FTS5 and idempotent message constraint work",()=>{
 const db=setup();
 const u1=db.prepare("INSERT INTO users(username,display_name,password_hash) VALUES(?,?,?)").run("user1","User One","hash").lastInsertRowid;
 const u2=db.prepare("INSERT INTO users(username,display_name,password_hash) VALUES(?,?,?)").run("user2","User Two","hash").lastInsertRowid;
 const cid=db.prepare("INSERT INTO conversations(type,created_by,direct_key) VALUES('direct',?,'1:2')").run(u1).lastInsertRowid;
 db.prepare("INSERT INTO conversation_members(conversation_id,user_id,role) VALUES(?,?, 'member'),(?,?, 'member')").run(cid,u1,cid,u2);
 const insert=db.prepare("INSERT INTO messages(conversation_id,sender_id,client_id,body,rev) VALUES(?,?,?,?,?)");
 insert.run(cid,u1,"123e4567-e89b-12d3-a456-426614174000","hello duet",1);
 assert.equal(db.prepare("SELECT COUNT(*) AS count FROM messages_fts WHERE messages_fts MATCH 'duet'").get().count,1);
 assert.throws(()=>insert.run(cid,u1,"123e4567-e89b-12d3-a456-426614174000","duplicate",2));
 assert.throws(()=>db.prepare("INSERT INTO conversations(type,created_by,direct_key) VALUES('direct',?,'1:2')").run(u2));
 db.close();
});
test("new group members cannot query earlier messages",()=>{
 const db=setup();
 const u1=db.prepare("INSERT INTO users(username,display_name,password_hash) VALUES('owner','Owner','x')").run().lastInsertRowid;
 const u2=db.prepare("INSERT INTO users(username,display_name,password_hash) VALUES('joined','Joined','x')").run().lastInsertRowid;
 const cid=db.prepare("INSERT INTO conversations(type,title,created_by) VALUES('group','Test Group',?)").run(u1).lastInsertRowid;
 db.prepare("INSERT INTO conversation_members(conversation_id,user_id,role,joined_at) VALUES(?,?, 'owner','2026-01-01T00:00:00.000Z')").run(cid,u1);
 db.prepare("INSERT INTO conversation_members(conversation_id,user_id,role,joined_at) VALUES(?,?, 'member','2026-01-05T00:00:00.000Z')").run(cid,u2);
 db.prepare("INSERT INTO messages(conversation_id,sender_id,client_id,body,created_at,rev) VALUES(?,?,?,?,?,?)").run(cid,u1,"123e4567-e89b-12d3-a456-426614174001","old message","2026-01-03T00:00:00.000Z",1);
 db.prepare("INSERT INTO messages(conversation_id,sender_id,client_id,body,created_at,rev) VALUES(?,?,?,?,?,?)").run(cid,u1,"123e4567-e89b-12d3-a456-426614174002","new message","2026-01-06T00:00:00.000Z",2);
 const visible=db.prepare("SELECT body FROM messages WHERE conversation_id=? AND created_at>=? ORDER BY id").all(cid,"2026-01-05T00:00:00.000Z");
 assert.deepEqual(visible.map(row=>row.body),["new message"]);
 db.close();
});
