/**
 * Browser-only client path: loads the bundled SDK so AuraClient runs in the page (DevTools console).
 * Regenerate the bundle from the node/ folder (where package.json is), not from node/tests/:
 *   npm run build && npm run bundle:test-client
 * If you run esbuild by hand from node/tests/, use ../dist/client.js and --outfile=./auralogger-client.browser.mjs
 */
import clientModule from "./auralogger-client.browser.mjs";

const { AuraClient } = clientModule;

function resolveProjectToken() {
  const fromQuery = new URLSearchParams(globalThis.location?.search ?? "").get(
    "projectToken",
  );
  const fromLocalStorage =
    globalThis.localStorage?.getItem("AURALOGGER_PROJECT_TOKEN") ?? null;
  const picked = (fromQuery ?? fromLocalStorage ?? "").trim();
  if (picked) return picked;

  const prompted = globalThis.prompt?.(
    "Paste AURALOGGER_PROJECT_TOKEN (or NEXT_PUBLIC_*/VITE_* equivalent). It will be stored in localStorage for this test page.",
  );
  const token = (prompted ?? "").trim();
  if (!token) {
    throw new Error(
      "Missing project token. Provide ?projectToken=... or set localStorage['AURALOGGER_PROJECT_TOKEN'].",
    );
  }
  try {
    globalThis.localStorage?.setItem("AURALOGGER_PROJECT_TOKEN", token);
  } catch {
    // ignore storage failures (private mode, blocked storage, etc.)
  }
  return token;
}

let configured = false;

function ensureConfigured() {
  if (configured) return;
  AuraClient.configure(resolveProjectToken());
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
