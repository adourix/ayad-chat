import type { Message } from "./api";
export type SocketEvent = { t: string; [key: string]: unknown };

export class ChatSocket {
  private socket?: WebSocket;
  private retry = 0;
  private timer: number | undefined;
  private heartbeat: number | undefined;
  private closed = false;
  private callbacks = new Set<(event: SocketEvent) => void>();
  private subscribed: number | undefined;

  connect() { this.closed = false; this.open(); }
  private emit(event: SocketEvent) { this.callbacks.forEach((callback) => callback(event)); }

  private open() {
    if (this.closed) return;
    const protocol = location.protocol === "https:" ? "wss:" : "ws:";
    this.socket = new WebSocket(protocol + "//" + location.host + "/ws");
    this.socket.onopen = () => {
      this.retry = 0;
      this.emit({ t: "socket.state", live: true });
      this.send({ t: "hello", protocol: 1, since_rev: Number(localStorage.getItem("duet_rev") || 0) });
      if (this.subscribed) this.send({ t: "conversation.subscribe", conversation_id: this.subscribed });
      if (this.heartbeat) clearInterval(this.heartbeat);
      this.heartbeat = window.setInterval(() => this.send({ t: "ping" }), 25_000);
    };
    this.socket.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data) as SocketEvent;
        if (data.t === "msg.new" && data.message) {
          const message = data.message as Message;
          const current = Number(localStorage.getItem("duet_rev") || 0);
          localStorage.setItem("duet_rev", String(Math.max(current, message.rev)));
        }
        if (data.t === "sync.batch" && Array.isArray(data.messages)) {
          const maxRevision = (data.messages as Message[]).reduce((max, message) => Math.max(max, message.rev), 0);
          if (maxRevision) {
            const current = Number(localStorage.getItem("duet_rev") || 0);
            localStorage.setItem("duet_rev", String(Math.max(current, maxRevision)));
          }
        }
        this.emit(data);
      } catch { /* Ignore malformed frames. */ }
    };
    this.socket.onclose = () => {
      if (this.heartbeat) clearInterval(this.heartbeat);
      this.heartbeat = undefined;
      this.emit({ t: "socket.state", live: false });
      this.schedule();
    };
    this.socket.onerror = () => this.socket?.close();
  }

  private schedule() {
    if (this.closed) return;
    const delay = Math.min(15_000, 700 * 2 ** this.retry++) * (0.7 + Math.random() * 0.6);
    this.timer = window.setTimeout(() => this.open(), delay);
  }
  send(payload: unknown) { if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(payload)); }
  subscribe(id: number) { if (this.subscribed && this.subscribed !== id) this.send({ t: "conversation.unsubscribe", conversation_id: this.subscribed }); this.subscribed = id; this.send({ t: "conversation.subscribe", conversation_id: id }); }
  unsubscribe(id: number) { if (this.subscribed === id) this.subscribed = undefined; this.send({ t: "conversation.unsubscribe", conversation_id: id }); }
  on(callback: (event: SocketEvent) => void) { this.callbacks.add(callback); return () => this.callbacks.delete(callback); }
  close() {
    this.closed = true;
    if (this.timer) clearTimeout(this.timer);
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.socket?.close(1000, "logout");
  }
}
