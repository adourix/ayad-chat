import { z } from "zod";

export const PROTOCOL_VERSION = 1 as const;

export const idSchema = z.number().int().positive();
export const conversationIdSchema = idSchema;
export const clientIdSchema = z.string().uuid();

export const messageKindSchema = z.enum(["text", "image", "file", "voice", "system"]);

export const messageSchema = z.object({
  id: idSchema,
  client_id: clientIdSchema,
  conversation_id: conversationIdSchema,
  sender_id: idSchema,
  kind: messageKindSchema,
  body: z.string(),
  body_format: z.number().int().nonnegative().default(0),
  reply_to_id: idSchema.nullable(),
  created_at: z.string().datetime(),
  edited_at: z.string().datetime().nullable(),
  deleted_at: z.string().datetime().nullable(),
  rev: z.number().int().positive(),
});
export type Message = z.infer<typeof messageSchema>;

export const clientEnvelopeSchema = z.discriminatedUnion("t", [
  z.object({ t: z.literal("hello"), protocol: z.literal(PROTOCOL_VERSION), since_rev: z.number().int().nonnegative() }),
  z.object({ t: z.literal("conversation.subscribe"), conversation_id: conversationIdSchema }),
  z.object({ t: z.literal("conversation.unsubscribe"), conversation_id: conversationIdSchema }),
  z.object({ t: z.literal("msg.send"), conversation_id: conversationIdSchema, client_id: clientIdSchema, body: z.string().min(1).max(8_192), reply_to: idSchema.optional() }),
  z.object({ t: z.literal("ping") }),
]);
export type ClientEnvelope = z.infer<typeof clientEnvelopeSchema>;

export const serverEnvelopeSchema = z.discriminatedUnion("t", [
  z.object({ t: z.literal("hello.ok"), protocol: z.literal(PROTOCOL_VERSION), server_rev: z.number().int().nonnegative() }),
  z.object({ t: z.literal("msg.ack"), client_id: clientIdSchema, id: idSchema, created_at: z.string().datetime(), rev: z.number().int().positive() }),
  z.object({ t: z.literal("msg.new"), message: messageSchema }),
  z.object({ t: z.literal("error"), code: z.string(), ref: z.string().optional() }),
  z.object({ t: z.literal("pong") }),
]);
export type ServerEnvelope = z.infer<typeof serverEnvelopeSchema>;
