import Fastify from "fastify";
import cookie from "@fastify/cookie";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import {resolve} from "node:path";
import {config} from "./config.js";
import {db} from "./db/client.js";
import "./db/migrate.js";
import {registerHealthRoutes} from "./routes/health.js";
import {registerAuthRoutes} from "./routes/auth.js";
import {registerConversationRoutes} from "./routes/conversations.js";
import {registerMessageRoutes} from "./routes/messages.js";
import {registerUserRoutes} from "./routes/users.js";
import {registerMediaRoutes} from "./routes/media.js";
import {attachWebSocket} from "./realtime/wsHub.js";
import {cleanupSessions} from "./auth/session.js";

const app=Fastify({logger:{level:config.LOG_LEVEL},trustProxy:["127.0.0.1","::1"],bodyLimit:25*1024*1024});
for(const mediaType of ["application/octet-stream","image/jpeg","image/png","image/webp","image/gif","video/mp4","video/webm","video/quicktime"]){
 app.addContentTypeParser(mediaType,{parseAs:"buffer",bodyLimit:25*1024*1024},(_request,body,done)=>done(null,body));
}
await app.register(helmet,{contentSecurityPolicy:false});
await app.register(cookie);
await app.register(rateLimit,{global:false});
app.addHook("onRequest",async(request,reply)=>{
 if(request.method==="GET"||request.method==="HEAD"||request.url==="/healthz")return;
 const origin=request.headers.origin;
 if(!origin||!config.allowedOrigins.has(origin))return reply.code(403).send({error:"origin_not_allowed"});
});
cleanupSessions();const sessionCleanupTimer=setInterval(cleanupSessions,24*60*60*1000);sessionCleanupTimer.unref();app.addHook("onClose",async()=>clearInterval(sessionCleanupTimer));
await registerHealthRoutes(app);
await registerAuthRoutes(app);
await registerConversationRoutes(app);
await registerMessageRoutes(app);
await registerUserRoutes(app);
await registerMediaRoutes(app);
if(config.NODE_ENV==="production"){
 await app.register(fastifyStatic,{root:resolve(process.cwd(),"web/dist"),prefix:"/",decorateReply:true});
 app.setNotFoundHandler((request,reply)=>{
  if(!request.url.startsWith("/api/")&&request.url!=="/ws")return reply.type("text/html").sendFile("index.html");
  return reply.code(404).send({error:"not_found"});
 });
}
attachWebSocket(app);
app.addHook("onClose",async()=>db.close());
try{await app.listen({host:config.HOST,port:config.PORT});}catch(error){app.log.error(error);await app.close();process.exit(1);}
const shutdown=async(signal:string)=>{app.log.info({signal},"Shutting down");await app.close();process.exit(0);};
process.once("SIGINT",()=>void shutdown("SIGINT"));
process.once("SIGTERM",()=>void shutdown("SIGTERM"));
