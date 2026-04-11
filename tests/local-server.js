const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const url = require("node:url");
const { runServerTest } = require("./server.js");

const HOST = "127.0.0.1";
const PORT = Number(process.env.AURALOGGER_TEST_PORT ?? 4173);
const TESTS_DIR = __dirname;

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

function parseJsonData(raw) {
  if (!raw) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function sendJson(res, code, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(code, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

function serveStatic(reqPath, res) {
  const relativePath = reqPath === "/" ? "/index.html" : reqPath;
  const safePath = path.normalize(relativePath).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(TESTS_DIR, safePath);

  if (!filePath.startsWith(TESTS_DIR)) {
    sendJson(res, 403, { ok: false, error: "Forbidden path" });
    return;
  }

  if (!fs.existsSync(filePath)) {
    sendJson(res, 404, { ok: false, error: "Not found" });
    return;
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] ?? "application/octet-stream";
  const data = fs.readFileSync(filePath);
  res.writeHead(200, {
    "Content-Type": contentType,
    "Content-Length": data.length,
  });
  res.end(data);
}

const server = http.createServer((req, res) => {
  try {
    if (!req.url || !req.method) {
      sendJson(res, 400, { ok: false, error: "Bad request" });
      return;
    }

    const parsed = new url.URL(req.url, `http://${HOST}:${PORT}`);
    const route = parsed.pathname;

    if (req.method === "GET" && route === "/test") {
      
      runServerTest();

      sendJson(res, 200, { ok: true, route: "/test", logged: true });
      return;
    }

    if (req.method === "GET" && route === "/test-default") {
      runServerTest();
      sendJson(res, 200, { ok: true, route: "/test-default", logged: true });
      return;
    }

    if (req.method !== "GET") {
      sendJson(res, 405, { ok: false, error: "Method not allowed" });
      return;
    }

    serveStatic(route, res);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    sendJson(res, 500, { ok: false, error: msg });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Auralogger test server running at http://${HOST}:${PORT}`);
  console.log("Open / for client page (browser client logs); GET /test runs AuraServer in Node");
});
