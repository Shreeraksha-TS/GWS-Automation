import { WebSocketServer, WebSocket } from "ws";
import type { Server } from "node:http";
import * as store from "../common/store.js";
import type { Execution } from "../common/types.js";

export function attachWs(server: Server): void {
  const wss = new WebSocketServer({ noServer: true });
  server.on("upgrade", (req, socket, head) => {
    const m = req.url?.match(/^\/ws\/executions\/([^/]+)\/logs$/);
    if (!m) { socket.destroy(); return; }
    wss.handleUpgrade(req, socket, head, ws => streamLogs(ws, m[1]));
  });
}

function streamLogs(ws: WebSocket, executionId: string): void {
  let lastLine = 0;
  let closing = false;

  const flush = () => {
    for (const rec of store.readLogs(executionId, lastLine)) {
      ws.send(JSON.stringify({ id: rec.id, level: rec.level, message: rec.message, timestamp: rec.timestamp }));
      lastLine = rec.id + 1;
    }
  };

  const timer = setInterval(() => {
    if (closing) return;
    flush();
    const ex = store.getEntity<Execution>(store.EXEC_DIR, executionId);
    if (ex && ["PASSED", "FAILED", "CANCELLED"].includes(ex.status)) {
      closing = true;
      clearInterval(timer);
      setTimeout(() => {                       // let the worker flush its last lines
        flush();
        try { ws.send(JSON.stringify({ type: "done", status: ex.status })); } catch { /* */ }
        ws.close();
      }, 1000);
    }
  }, 1000);

  ws.on("close", () => clearInterval(timer));
}
