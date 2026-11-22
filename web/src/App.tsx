import {useCallback,useEffect,useRef,useState} from "react";
import Login from "./components/Login";\nimport AccountSettings from "./components/AccountSettings";
import ConversationList from "./components/ConversationList";
import {api} from "./lib/api";
import {ChatSocket, type SocketEvent} from "./lib/socket";
import {useStore} from "./store";
import type {Message,User} from "./lib/api";

type OutboxItem={conversation_id:number;client_id:string;body:string;created_at:string};
const outboxKey=(userId:number)=> "duet_outbox_"+userId;
function readOutbox(userId:number):OutboxItem[]{try{return JSON.parse(localStorage.getItem(outboxKey(userId))||"[]") as OutboxItem[];}catch{return [];}}
function writeOutbox(userId:number,items:OutboxItem[]){try{localStorage.setItem(outboxKey(userId),JSON.stringify(items));}catch{}}
function pendingMessage(item:OutboxItem,user:User):Message{return{id:-Date.now(),conversation_id:item.conversation_id,sender_id:user.id,client_id:item.client_id,kind:"text",body:item.body,body_format:0,reply_to_id:null,created_at:item.created_at,edited_at:null,deleted_at:null,rev:0};}
function mergeMessages(existing:Message[],incoming:Message[]){const map=new Map(existing.map(m=>[m.client_id||String(m.id),m]));for(const m of incoming)map.set(m.client_id||String(m.id),m);return [...map.values()].sort((a,b)=>(a.rev===0?Number.MAX_SAFE_INTEGER:a.id)-(b.rev===0?Number.MAX_SAFE_INTEGER:b.id));}
function Welcome({onNew}:{onNew:()=>void}){return <div className="welcome-pane"><div className="welcome-mark">d.</div><h2>Space to talk.<br/><em>Room to breathe.</em></h2><p>Your conversations are private and kept on your own server.</p><button className="primary-link" onClick={onNew}>Start a conversation <span>↗</span></button></div>}

export default function App(){
 const [route,setRoute]=useState(location.pathname);
 const {user,conversations,activeId,messages,setUser,setConversations,setActive,setMessages,addMessage,socketLive,setSocketLive}=useStore();
 const socketRef=useRef<ChatSocket|null>(null);const bottomRef=useRef<HTMLDivElement>(null);
 const [draft,setDraft]=useState("");const [mobileChat,setMobileChat]=useState(false);const [showSettings,setShowSettings]=useState(false);
 const refresh=useCallback(async()=>{const [me,cs]=await Promise.all([api.me(),api.conversations()]);setUser(me.user);setConversations(cs);return me.user;},[setUser,setConversations]);

 useEffect(()=>{if(route==="/login")return;refresh().catch(()=>setUser(null));},[route,refresh,setUser]);
 useEffect(()=>{const handlePop=()=>setRoute(location.pathname);window.addEventListener("popstate",handlePop);return()=>window.removeEventListener("popstate",handlePop);},[]);
 useEffect(()=>{if(!user||!activeId)return;readOutbox(user.id).filter(item=>item.conversation_id===activeId).forEach(item=>addMessage(pendingMessage(item,user)));},[user?.id,activeId,addMessage]);

 useEffect(()=>{
  if(!user)return;
  const socket=new ChatSocket();socketRef.current=socket;socket.connect();
  const unsubscribe=socket.on((event:SocketEvent)=>{
   if(event.t==="socket.state"){
    const live=Boolean(event.live);setSocketLive(live);
    if(live)readOutbox(user.id).forEach(item=>socket.send({t:"msg.send",conversation_id:item.conversation_id,client_id:item.client_id,body:item.body}));
   }
   if(event.t==="hello.ok")setSocketLive(true);
   if(event.t==="msg.ack"){
    const ack=event as unknown as {client_id:string;id:number;created_at:string;rev:number};
    useStore.setState(state=>({messages:state.messages.map(m=>m.client_id===ack.client_id?{...m,id:ack.id,created_at:ack.created_at,rev:ack.rev}:m)}));
    writeOutbox(user.id,readOutbox(user.id).filter(item=>item.client_id!==ack.client_id));
   }
   if(event.t==="sync.batch"&&Array.isArray(event.messages)){
    const incoming=event.messages as Message[];
    writeOutbox(user.id,readOutbox(user.id).filter(item=>!incoming.some(m=>m.client_id===item.client_id)));
    if(incoming.some(m=>m.conversation_id===useStore.getState().activeId)){
     const activeIncoming=incoming.filter(m=>m.conversation_id===useStore.getState().activeId);
     useStore.getState().setMessages(mergeMessages(useStore.getState().messages,activeIncoming));
    }
   }
   if(event.t==="msg.new"&&event.message){
    const message=event.message as Message;
    writeOutbox(user.id,readOutbox(user.id).filter(item=>item.client_id!==message.client_id));
    if(message.conversation_id===useStore.getState().activeId){
     useStore.setState(state=>({messages:mergeMessages(state.messages,[message])}));api.markRead(message.conversation_id).then(()=>refresh()).catch(()=>{});
    }
    refresh().catch(()=>{});
   }
   if(event.t==="error"&&event.ref){
    const ref=String(event.ref);writeOutbox(user.id,readOutbox(user.id).filter(item=>item.client_id!==ref));
   }
   if(event.t==="error"&&event.code==="forbidden")setSocketLive(false);
  });
  return()=>{unsubscribe();socket.close();socketRef.current=null;setSocketLive(false);};
 },[user?.id,addMessage,refresh,setSocketLive]);

 useEffect(()=>{
  if(!activeId||!user||!socketRef.current)return;
  socketRef.current.subscribe(activeId);
  let alive=true;
  api.messages(activeId).then(result=>{
   if(!alive)return;
   const serverIds=new Set(result.messages.map(m=>m.client_id));
   const pending=readOutbox(user.id).filter(item=>item.conversation_id===activeId&&!serverIds.has(item.client_id)).map(item=>pendingMessage(item,user));
   setMessages(mergeMessages(result.messages,pending));api.markRead(activeId).then(()=>refresh()).catch(()=>{});
  }).catch(()=>{if(alive)setMessages([]);});
  return()=>{alive=false;};
 },[activeId,user?.id,setMessages]);
 useEffect(()=>{bottomRef.current?.scrollIntoView({behavior:"smooth"});},[messages,activeId]);

 async function signIn(){await refresh();setRoute("/");history.replaceState(null,"","/");}
 async function logout(){try{await api.logout();}catch{}socketRef.current?.close();setUser(null);setConversations([]);setActive(null);setRoute("/");history.replaceState(null,"","/");}
 function openConversation(id:number){setActive(id);setMobileChat(true);}
 async function createDirect(id:number){try{const result=await api.createDirect(id);await refresh();setActive(result.id);setMobileChat(true);}catch{}}
 async function createGroup(id:number){await refresh();setActive(id);setMobileChat(true);}
 function sendMessage(){
  const text=draft.trim();if(!text||!activeId||!user)return;
  const clientId=crypto.randomUUID();const createdAt=new Date().toISOString();
  const item:OutboxItem={conversation_id:activeId,client_id:clientId,body:text,created_at:createdAt};
  writeOutbox(user.id,[...readOutbox(user.id),item]);
  addMessage(pendingMessage(item,user));setDraft("");
  socketRef.current?.send({t:"msg.send",conversation_id:activeId,client_id:clientId,body:text});
 }
 const activeConversation=conversations.find(c=>c.id===activeId);\n if(!user)return <Login onSuccess={()=>{signIn().catch(()=>{});}}/>;\n return <><main className={"messenger "+(mobileChat?"mobile-chat-open":"")}><ConversationList items={conversations} active={activeId} onSelect={openConversation} onCreate={createDirect} onGroupCreated={createGroup} me={user!} onLogout={logout} onSettings={()=>setShowSettings(true)}/><section className="chat-pane">{activeId&&activeConversation?<><header className="chat-header"><button className="mobile-back icon-button" onClick={()=>setMobileChat(false)}>←</button><div className="avatar">{(activeConversation.title??"Chat").split(" ").slice(0,2).map(x=>x[0]).join("").toUpperCase()}</div><div className="chat-heading"><strong>{activeConversation.title??"Direct conversation"}</strong><span>{socketLive?"Connected":"Connecting…"}</span></div><button className="icon-button" title="Conversation details">•••</button></header><div className="message-list">{messages.map(m=><article key={m.client_id||m.id} className={"message "+(m.sender_id===user?.id?"mine":"theirs")}><div className="bubble">{m.deleted_at?"Message deleted":m.body}</div><time>{new Date(m.created_at).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"})}{m.rev===0&&<span className="pending"> · pending</span>}</time></article>)}<div ref={bottomRef}/></div><form className="composer" onSubmit={e=>{e.preventDefault();sendMessage();}}><textarea value={draft} onChange={e=>setDraft(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();sendMessage();}}} placeholder="Write a message…" rows={1}/><button className="send-button" disabled={!draft.trim()} type="submit">↑</button></form></>:<Welcome onNew={()=>document.querySelector<HTMLButtonElement>('.icon-button[title="Find people"]')?.click()}/>}</section> </main>{showSettings&&user&&<AccountSettings me={user} onClose={()=>setShowSettings(false)} onUpdated={updated=>{setUser(updated);refresh().catch(()=>{});}}/>}</>;;
}
