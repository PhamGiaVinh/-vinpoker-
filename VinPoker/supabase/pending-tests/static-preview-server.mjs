import { createReadStream, existsSync, statSync } from "node:fs";
import http from "node:http";
import { extname, join, normalize } from "node:path";

const root = "/app/dist";
const mime = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
};

http.createServer((request, response) => {
  const pathname = decodeURIComponent(new URL(request.url, "http://cashier-app").pathname);
  const candidate = normalize(join(root, pathname));
  const safe = candidate.startsWith(root) && existsSync(candidate) && statSync(candidate).isFile();
  const file = safe ? candidate : join(root, "index.html");
  response.writeHead(200, {
    "Content-Type": mime[extname(file)] ?? "application/octet-stream",
    "Cache-Control": "no-store",
  });
  createReadStream(file).pipe(response);
}).listen(8080, "0.0.0.0");
