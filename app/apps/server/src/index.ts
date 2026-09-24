import { createServer } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import type { ServerMessage } from "@rs/shared";
import { MatchHub } from "./match-hub";
import { createTicketExchanger } from "./steam-auth";

const PORT = Number(process.env.MATCH_SERVER_PORT ?? process.env.PORT ?? 8787);

const sockets = new Map<string, WebSocket>();
let nextId = 1;

function connectionIdFor(ws: WebSocket): string {
  const existing = [...sockets.entries()].find(([, sock]) => sock === ws)?.[0];
  if (existing) return existing;
  const id = `c${nextId++}`;
  sockets.set(id, ws);
  return id;
}

function emit(connectionId: string, message: ServerMessage): void {
  const ws = sockets.get(connectionId);
  if (!ws || ws.readyState !== ws.OPEN) return;
  ws.send(JSON.stringify(message));
}

const hub = new MatchHub(emit, {
  botFillMs: process.env.MATCH_BOT_FILL_MS
    ? Number(process.env.MATCH_BOT_FILL_MS)
    : undefined,
  exchanger: createTicketExchanger(process.env),
});

const server = createServer((_req, res) => {
  res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
  res.end("requirement-storm match-server (RedQueen V1)\n");
});

const wss = new WebSocketServer({ server });

wss.on("connection", (ws) => {
  const connectionId = connectionIdFor(ws);

  ws.on("message", (data) => {
    const raw = typeof data === "string" ? data : data.toString("utf8");
    hub.handleMessage(connectionId, raw);
  });

  ws.on("close", () => {
    hub.onDisconnect(connectionId);
    sockets.delete(connectionId);
  });
});

server.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(
    `[match-server] ws://localhost:${PORT}  (RedQueen V1: join/intent/view/force/resync/leave, auth=${hub.authMode})`,
  );
});
