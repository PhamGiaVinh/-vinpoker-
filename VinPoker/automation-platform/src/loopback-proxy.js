import net from "node:net";
import { pathToFileURL } from "node:url";

const ROUTES = Object.freeze([
  Object.freeze({ listenPort: 8787, targetHost: "gateway", targetPort: 8787 }),
  Object.freeze({ listenPort: 5678, targetHost: "n8n", targetPort: 5678 }),
]);

export function createTcpProxy({
  listenHost = "0.0.0.0",
  listenPort,
  targetHost,
  targetPort,
}) {
  if (!Number.isInteger(listenPort) || !Number.isInteger(targetPort)) {
    throw new TypeError("Proxy ports must be integers");
  }

  if (!targetHost) {
    throw new TypeError("Proxy targetHost is required");
  }

  return net.createServer((client) => {
    const upstream = net.createConnection({ host: targetHost, port: targetPort });

    client.pipe(upstream);
    upstream.pipe(client);

    client.on("error", () => upstream.destroy());
    upstream.on("error", (error) => {
      console.error(
        `Loopback proxy upstream unavailable on ${listenPort}: ${error.code ?? "ERROR"}`,
      );
      client.destroy();
    });
  }).listen({ host: listenHost, port: listenPort });
}

export function startLoopbackProxy(routes = ROUTES) {
  const servers = routes.map((route) => createTcpProxy(route));

  const shutdown = () => {
    for (const server of servers) server.close();
  };

  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);

  return servers;
}

const isEntrypoint =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isEntrypoint) {
  startLoopbackProxy();
  console.log("VBacker loopback proxy listening on 127.0.0.1 published ports");
}
