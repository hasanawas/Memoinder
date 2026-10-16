// Serves the static build (out/) the way GitHub Pages does, including the
// /<repo> prefix, so tests run against what will really be deployed.
// Usage: node scripts/serve-static.mjs [port]   (prefix from NEXT_PUBLIC_BASE_PATH)
import http from "node:http";
import fs from "node:fs";
import path from "node:path";

const port = Number(process.argv[2] ?? 3100);
const base = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
const root = path.resolve("out");
const types = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css",
  ".json": "application/json", ".webmanifest": "application/manifest+json", ".png": "image/png",
  ".ico": "image/x-icon", ".svg": "image/svg+xml", ".txt": "text/plain; charset=utf-8", ".woff2": "font/woff2",
};

function send(res, status, file) {
  res.writeHead(status, { "Content-Type": types[path.extname(file)] ?? "application/octet-stream", "Cache-Control": "no-cache" });
  fs.createReadStream(file).pipe(res);
}

http
  .createServer((req, res) => {
    const url = new URL(req.url, "http://x");
    if (base && !url.pathname.startsWith(`${base}/`) && url.pathname !== base) return send(res, 404, path.join(root, "404.html"));
    const rel = decodeURIComponent(url.pathname.slice(base.length)) || "/";
    const file = path.join(root, rel);
    if (!file.startsWith(root)) return send(res, 404, path.join(root, "404.html"));
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) {
      if (!url.pathname.endsWith("/")) {
        res.writeHead(301, { Location: `${url.pathname}/${url.search}` });
        return res.end();
      }
      const index = path.join(file, "index.html");
      return fs.existsSync(index) ? send(res, 200, index) : send(res, 404, path.join(root, "404.html"));
    }
    if (fs.existsSync(file)) return send(res, 200, file);
    send(res, 404, path.join(root, "404.html"));
  })
  .listen(port, "localhost", () => console.log(`Serving out/ at http://localhost:${port}${base}/`));
