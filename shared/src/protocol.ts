import {z} from "zod";
export const PROTOCOL_VERSION=1 as const;
export const idSchema=z.number().int().positive();
export const conversationIdSchema=idSchema;
export const clientIdSchema=z.string().uuid();
export const messageKindSchema=z.enum(["text","image","video","file","voice","system"]);
export const messageSchema=z.object({
 id:idSchema,client_id:clientIdSchema,conversation_id:conversationIdSchema,sender_id:idSchema,
 kind:messageKindSchema,body:z.string(),body_format:z.number().int().nonnegative().default(0),
 reply_to_id:idSchema.nullable(),attachment:z.object({id:idSchema,mime:z.string(),size:z.number().int(),width:z.number().int().nullable(),height:z.number().int().nullable(),duration_ms:z.number().int().nullable(),url:z.string(),thumb_url:z.string().nullable().optional()}).nullable().optional(),
 reactions:z.array(z.object({user_id:idSchema,emoji:z.string().min(1).max(32)})).optional(),
 created_at:z.string().datetime(),edited_at:z.string().datetime().nullable(),deleted_at:z.string().datetime().nullable(),rev:z.number().int().positive(),
});
export type Message=z.infer<typeof messageSchema>;
const titleSchema=z.string().trim().min(1).max(80);
const bodySchema=z.string().min(1).max(8192);
export const clientEnvelopeSchema=z.discriminatedUnion("t",[
 z.object({t:z.literal("hello"),protocol:z.literal(PROTOCOL_VERSION),since_rev:z.number().int().nonnegative()}),
 z.object({t:z.literal("conversation.subscribe"),conversation_id:conversationIdSchema}),
 z.object({t:z.literal("conversation.unsubscribe"),conversation_id:conversationIdSchema}),
 z.object({t:z.literal("group.create"),title:titleSchema,member_ids:z.array(idSchema).min(2).max(4)}),
 z.object({t:z.literal("group.update"),conversation_id:conversationIdSchema,title:titleSchema.optional(),avatar_key:z.string().max(128).nullable().optional()}),
 z.object({t:z.literal("member.add"),conversation_id:conversationIdSchema,user_id:idSchema}),
 z.object({t:z.literal("member.remove"),conversation_id:conversationIdSchema,user_id:idSchema}),
 z.object({t:z.literal("msg.send"),conversation_id:conversationIdSchema,client_id:clientIdSchema,body:bodySchema,reply_to:idSchema.optional(),kind:z.enum(["text","image","video","file"]).default("text"),attachment_id:idSchema.optional()}),
 z.object({t:z.literal("msg.edit"),conversation_id:conversationIdSchema,id:idSchema,body:z.string().min(1).max(8192)}),
 z.object({t:z.literal("msg.delete"),conversation_id:conversationIdSchema,id:idSchema}),
 z.object({t:z.literal("react"),conversation_id:conversationIdSchema,id:idSchema,emoji:z.string().max(32).nullable()}),
 z.object({t:z.literal("receipt"),conversation_id:conversationIdSchema,delivered_up_to:idSchema.optional(),read_up_to:idSchema.optional()}),
 z.object({t:z.literal("typing"),conversation_id:conversationIdSchema,on:z.boolean()}),
 z.object({t:z.literal("ping")}),
]);
export type ClientEnvelope=z.infer<typeof clientEnvelopeSchema>;
const userSchema=z.object({id:idSchema,username:z.string(),display_name:z.string()});
const conversationSchema=z.object({id:conversationIdSchema,type:z.enum(["direct","group"]),title:z.string().nullable(),updated_at:z.string(),last_message_id:idSchema.nullable().optional(),role:z.string().optional(),joined_at:z.string().optional(),last_read_id:z.number().int().optional(),last_delivered_id:z.number().int().optional()});
export const serverEnvelopeSchema=z.discriminatedUnion("t",[
 z.object({t:z.literal("hello.ok"),protocol:z.literal(PROTOCOL_VERSION),server_rev:z.number().int().nonnegative(),user:userSchema,conversations:z.array(conversationSchema),presence_snapshot:z.array(z.object({user_id:idSchema,online:z.boolean(),last_seen_at:z.string().datetime().nullable()})).optional()}),
 z.object({t:z.literal("sync.batch"),messages:z.array(messageSchema)}),
 z.object({t:z.literal("sync.done"),server_rev:z.number().int().nonnegative()}),
 z.object({t:z.literal("conversation.subscribed"),conversation_id:conversationIdSchema}),
 z.object({t:z.literal("msg.ack"),client_id:clientIdSchema,id:idSchema,created_at:z.string().datetime(),rev:z.number().int().positive()}),
 z.object({t:z.literal("msg.new"),message:messageSchema}),
 z.object({t:z.literal("msg.update"),message:messageSchema}),
 z.object({t:z.literal("receipt"),conversation_id:idSchema,user_id:idSchema,delivered_up_to:idSchema.optional(),read_up_to:idSchema.optional()}),
 z.object({t:z.literal("typing"),conversation_id:idSchema,user_id:idSchema,on:z.boolean()}),
 z.object({t:z.literal("presence"),user_id:idSchema,online:z.boolean(),last_seen_at:z.string().datetime().nullable()}),
 z.object({t:z.literal("conversation.updated"),conversation:conversationSchema}),
 z.object({t:z.literal("member.updated"),conversation_id:idSchema,user_id:idSchema,action:z.enum(["joined","left","role_changed"])}),
 z.object({t:z.literal("error"),code:z.string(),ref:z.string().optional()}),
 z.object({t:z.literal("pong")}),
]);
export type ServerEnvelope=z.infer<typeof serverEnvelopeSchema>;
