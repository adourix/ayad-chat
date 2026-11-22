import type {Message} from './api';
export type SocketEvent={t:string;[key:string]:unknown};
export class ChatSocket{
 private socket?:WebSocket;private retry=0;private timer?:number;private heartbeat?:number;private closed=false;private callbacks=new Set<(e:SocketEvent)=>void>();private subscribed?:number;
 connect(){this.closed=false;this.open();}
 private emit(event:SocketEvent){this.callbacks.forEach(cb=>cb(event));}
 private open(){if(this.closed)return;const proto=location.protocol==='https:'?'wss:':'ws:';this.socket=new WebSocket(proto+'//'+location.host+'/ws');this.socket.onopen=()=>{this.retry=0;this.emit({t:'socket.state',live:true});this.send({t:'hello',protocol:1,since_rev:Number(localStorage.getItem('duet_rev')||0});if(this.subscribed)this.send({t:'conversation.subscribe',conversation_id:this.subscribed});if(this.heartbeat)clearInterval(this.heartbeat);this.heartbeat=window.setInterval(()=>this.send({t:'ping'}),25000);};this.socket.onmessage=e=>{try{const data=JSON.parse(e.data) as SocketEvent;if(data.t==='msg.new'&&data.message){const m=data.message as Message;localStorage.setItem('duet_rev',String(Math.max(Number(localStorage.getItem('duet_rev')||0),m.rev));}if(data.t==='sync.batch'&&Array.isArray(data.messages)){const max=(data.messages as Message[]).reduce((v,m)=>Math.max(v,m.rev),0);if(max)localStorage.setItem('duet_rev',String(Math.max(Number(localStorage.getItem('duet_rev')||0),max));}this.emit(data);}catch{}};this.socket.onclose=()=>{if(this.heartbeat)clearInterval(this.heartbeat);this.heartbeat=undefined;this.emit({t:'socket.state',live:false});this.schedule();};this.socket.onerror=()=>this.socket?.close();}
 private schedule(){if(this.closed)return;const delay=Math.min(15000,700*2**this.retry++)*(.7+Math.random()*.6);this.timer=window.setTimeout(()=>this.open(),delay);}
 send(payload:unknown){if(this.socket?.readyState===WebSocket.OPEN)this.socket.send(JSON.stringify(payload));}
 subscribe(id:number){this.subscribed=id;this.send({t:'conversation.subscribe',conversation_id:id});}
 unsubscribe(id:number){if(this.subscribed===id)this.subscribed=undefined;this.send({t:'conversation.unsubscribe',conversation_id:id});}
 on(cb:(e:SocketEvent)=>void){this.callbacks.add(cb);return()=>this.callbacks.delete(cb);}
 close(){this.closed=true;if(this.timer)clearTimeout(this.timer);if(this.heartbeat)clearInterval(this.heartbeat);this.socket?.close(1000,'logout');}
}
