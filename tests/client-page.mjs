/**
 * Browser-only client path: loads the bundled SDK so AuraClient runs in the page (DevTools console).
 * Regenerate the bundle from the node/ folder (where package.json is), not from node/tests/:
 *   npm run build && npm run bundle:test-client
 * If you run esbuild by hand from node/tests/, use ../dist/client.js and --outfile=./auralogger-client.browser.mjs
 */
import clientModule from "./auralogger-client.browser.mjs";

const { AuraClient } = clientModule;

// Same token as tests/client.js (Node harness only — do not ship real tokens in production apps).
const PROJECT_TOKEN =
  "9g/mr4Q0MSxD8Yc0k19WK+B6BLnj0t8nGva1RLD/E4i+7zSMoMpTbCqr9FSZ3Q6fX6o4eUGysUaf5jax";

let configured = false;

function ensureConfigured() {
  if (configured) return;
  AuraClient.configure(PROJECT_TOKEN);
  configured = true;
}

/** Runs AuraClient in the browser; styled log lines appear in DevTools, not the Node terminal. */
export async function runClientTest() {
  console.log("[browser] AuraClient.log → open DevTools Console for Auralogger output");
  ensureConfigured();
  AuraClient.log(
    "info",
    "new client tests",
    "node/tests/index.html",
    { source: "test-page-client" },
  );
  return { ok: true, route: "browser", logged: true };
}

async function readJsonResponse(res) {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/** Triggers Node AuraServer log via GET /test. */
export async function runServerTest() {
  const res = await fetch("/test");
  const body = await readJsonResponse(res);
  if (!res.ok) {
    const err =
      typeof body === "object" && body !== null && "error" in body
        ? String(body.error)
        : String(body);
    throw new Error(err);
  }
  return body;
}
