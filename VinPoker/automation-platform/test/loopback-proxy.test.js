import assert from "node:assert/strict";
import net from "node:net";
import test from "node:test";
import { createTcpProxy } from "../src/loopback-proxy.js";

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(server.address()));
  });
}

function close(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

test("loopback proxy forwards bytes only to its configured upstream", async () => {
  const upstream = net.createServer((socket) => socket.pipe(socket));
  const upstreamAddress = await listen(upstream);
  const proxy = createTcpProxy({
    listenHost: "127.0.0.1",
    listenPort: 0,
    targetHost: "127.0.0.1",
    targetPort: upstreamAddress.port,
  });

  await new Promise((resolve, reject) => {
    if (proxy.listening) return resolve();
    proxy.once("listening", resolve);
    proxy.once("error", reject);
  });

  const proxyAddress = proxy.address();
  const response = await new Promise((resolve, reject) => {
    const socket = net.createConnection(proxyAddress.port, "127.0.0.1");
    socket.setEncoding("utf8");
    socket.once("error", reject);
    socket.once("data", (data) => {
      socket.end();
      resolve(data);
    });
    socket.write("digest-local-e2e");
  });

  assert.equal(response, "digest-local-e2e");
  await close(proxy);
  await close(upstream);
});
