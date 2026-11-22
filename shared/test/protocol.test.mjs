import test from "node:test";
import assert from "node:assert/strict";
import {clientEnvelopeSchema,messageSchema,serverEnvelopeSchema,PROTOCOL_VERSION} from "../dist/index.js";
test("accepts a version-matched hello",()=>{assert.equal(clientEnvelopeSchema.safeParse({t:"hello",protocol:PROTOCOL_VERSION,since_rev:0}).success,true);});
test("rejects invalid message idempotency identifiers and empty bodies",()=>{assert.equal(clientEnvelopeSchema.safeParse({t:"msg.send",conversation_id:3,client_id:"not-a-uuid",body:"hello"}).success,false);assert.equal(clientEnvelopeSchema.safeParse({t:"msg.send",conversation_id:3,client_id:"123e4567-e89b-12d3-a456-426614174000",body:""}).success,false);});
test("validates the canonical message shape",()=>{const result=messageSchema.safeParse({id:1,client_id:"123e4567-e89b-12d3-a456-426614174000",conversation_id:1,sender_id:1,kind:"text",body:"hello",body_format:0,reply_to_id:null,created_at:"2026-11-22T10:00:00Z",edited_at:null,deleted_at:null,rev:1});assert.equal(result.success,true);});
test("validates a hello response with session and conversation metadata",()=>{const result=serverEnvelopeSchema.safeParse({t:"hello.ok",protocol:1,server_rev:0,user:{id:1,username:"ayad",display_name:"Ayad"},conversations:[]});assert.equal(result.success,true);});
