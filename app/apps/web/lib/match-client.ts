import type { ClientMessage, ServerMessage } from "@rs/shared";

export function matchWsUrl(): string {
  if (typeof process !== "undefined" && process.env.NEXT_PUBLIC_WS_URL) {
    return process.env.NEXT_PUBLIC_WS_URL;
  }
  return "ws://localhost:8787";
}

export type MatchClientHandlers = {
  onMessage: (message: ServerMessage) => void;
  onOpen?: () => void;
  onClose?: () => void;
  onError?: () => void;
};

/** Thin WS client for RedQueen join / intent / resync / leave. */
export class MatchClient {
  private ws: WebSocket | null = null;
  private readonly handlers: MatchClientHandlers;

  constructor(handlers: MatchClientHandlers) {
    this.handlers = handlers;
  }

  get ready(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  connect(url = matchWsUrl()): void {
    this.close();
    const ws = new WebSocket(url);
    this.ws = ws;
    ws.onopen = () => this.handlers.onOpen?.();
    ws.onclose = () => this.handlers.onClose?.();
    ws.onerror = () => this.handlers.onError?.();
    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(String(event.data)) as ServerMessage;
        this.handlers.onMessage(message);
      } catch {
        // ignore malformed frames
      }
    };
  }

  send(message: ClientMessage): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify(message));
  }

  close(): void {
    if (!this.ws) return;
    this.ws.onopen = null;
    this.ws.onclose = null;
    this.ws.onerror = null;
    this.ws.onmessage = null;
    if (
      this.ws.readyState === WebSocket.OPEN ||
      this.ws.readyState === WebSocket.CONNECTING
    ) {
      this.ws.close();
    }
    this.ws = null;
  }
}
