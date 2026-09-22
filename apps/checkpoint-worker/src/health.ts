import { createServer, Server } from "http";
import { logger } from "./logger";

export type WorkerHealthState = {
  status: "starting" | "ok" | "unhealthy";
  lastCycleAt: string | null;
  lastError: string | null;
};

/**
 * Minimal internal HTTP listener, separate from any web traffic, so
 * Docker/orchestration can probe /health independently of the checkpoint
 * schedule itself.
 */
export function startHealthServer(port: number, state: WorkerHealthState): Server {
  const server = createServer((req, res) => {
    if (req.url === "/health") {
      const body = JSON.stringify(state);
      res.writeHead(state.status === "unhealthy" ? 503 : 200, {
        "Content-Type": "application/json",
      });
      res.end(body);
      return;
    }
    res.writeHead(404);
    res.end();
  });

  server.listen(port, () => {
    logger.info(`Health endpoint listening on port ${port}`);
  });

  return server;
}
