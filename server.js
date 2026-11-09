/**
 * HOLOCORE — local development server
 * Cross-platform static server using only Node.js built-ins.
 * Bind to loopback: localhost is a secure context for webcam permissions.
 */
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const HOST = process.env.HOLOCORE_HOST || "127.0.0.1";
const PORT = Number(process.env.PORT || 8000);

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".wasm": "application/wasm",
  ".task": "application/octet-stream",
  ".glb": "model/gltf-binary",
  ".gltf": "model/gltf+json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8"
};

function send(res, status, message) {
  res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8", "X-Content-Type-Options": "nosniff" });
  res.end(message);
}

const server = createServer(async (req, res) => {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.setHeader("Allow", "GET, HEAD");
    return send(res, 405, "Method not allowed");
  }

  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, `http://${HOST}:${PORT}`).pathname);
  } catch {
    return send(res, 400, "Bad request");
  }

  const relative = pathname.replace(/^\/+/, "") || "index.html";
  const target = path.resolve(ROOT, relative);
  if (target !== ROOT && !target.startsWith(ROOT + path.sep)) {
    return send(res, 403, "Forbidden");
  }

  try {
    let info = await stat(target);
    let filePath = target;
    if (info.isDirectory()) {
      filePath = path.join(target, "index.html");
      info = await stat(filePath);
    }
    if (!info.isFile()) return send(res, 404, "Not found");

    const body = req.method === "HEAD" ? null : await readFile(filePath);
    res.writeHead(200, {
      "Content-Type": TYPES[path.extname(filePath).toLowerCase()] || "application/octet-stream",
      "Content-Length": info.size,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "no-cache"
    });
    res.end(body);
  } catch {
    send(res, 404, "Not found");
  }
});

server.listen(PORT, HOST, () => {
  console.log("");
  console.log("  HOLOCORE local server");
  console.log(`  http://localhost:${PORT}`);
  console.log("  Press Ctrl+C to stop.");
  console.log("");
});
