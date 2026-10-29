// Zero-dependency static server for local development: `npm start`, then open http://localhost:8080.
import http from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const PORT = Number(process.env.PORT ?? 8080);
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png" };

http
  .createServer(async (req, res) => {
    const path = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname)).replace(/^([/\\])+/, "");
    if (path.startsWith("..")) {
      res.writeHead(403).end();
      return;
    }
    try {
      const file = join(ROOT, path === "" ? "index.html" : path);
      const body = await readFile(file);
      res.writeHead(200, { "content-type": `${TYPES[extname(file)] ?? "application/octet-stream"}; charset=utf-8` }).end(body);
    } catch {
      res.writeHead(404).end("not found");
    }
  })
  .listen(PORT, "127.0.0.1", () => console.log(`http://localhost:${PORT}`));
