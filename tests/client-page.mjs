/**
 * Browser harness: loads the bundled SDK so AuraClient runs in the page (DevTools console).
 *
 * From the `node/` folder (where package.json lives):
 *   npm run build && npm run bundle:test-client
 *
 * Optional URL flags:
 *   ?projectToken=...           — one-off token (not stored)
 *   ?auraloggerDebug=1        — sets globalThis.__AURALOGGER_DEBUG__ for `auralogger:debug` lines in client-log
 *
 * Default project token is loaded from ./harness-defaults.json (same as Node tests).
 */
import clientModule from "./auralogger-client.browser.mjs";

const { AuraClient } = clientModule;

const harnessDefaultsPromise = fetch(new URL("./harness-defaults.json", import.meta.url)).then(
  async (res) => {
    if (!res.ok) {
      throw new Error(`harness-defaults.json: HTTP ${res.status}`);
    }
    return res.json();
  },
);

function maybeEnableDebugFromUrl() {
  const params = new URLSearchParams(globalThis.location?.search ?? "");
  if (params.get("auraloggerDebug") === "1") {
    globalThis.__AURALOGGER_DEBUG__ = true;
  }
}

async function resolveProjectToken() {
  maybeEnableDebugFromUrl();

  const params = new URLSearchParams(globalThis.location?.search ?? "");
  const fromQuery = params.get("projectToken")?.trim();
  if (fromQuery) {
    return fromQuery;
  }

  const fromLocalStorage = globalThis.localStorage?.getItem("AURALOGGER_PROJECT_TOKEN")?.trim();
  if (fromLocalStorage) {
    return fromLocalStorage;
  }

  const { DEFAULT_TEST_PROJECT_TOKEN } = await harnessDefaultsPromise;
  return DEFAULT_TEST_PROJECT_TOKEN;
}

let configured = false;

async function ensureConfigured() {
  if (configured) {
    return;
  }
  AuraClient.configure(await resolveProjectToken());
  configured = true;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Runs AuraClient in the browser; styled log lines appear in DevTools. Waits for batch flush via closeSocket. */
export async function runClientTest() {
  console.log(
    "[browser] AuraClient.log → open DevTools Console. Add ?auraloggerDebug=1 for SDK debug lines.",
  );
  await ensureConfigured();

  const clientLogs = [
    ["info", "client test suite started", "node/tests/index.html", { source: "test-page-client" }],
    ["warn", "localStorage quota nearing limit", "node/tests/index.html", { usedKB: 4800, limitKB: 5120 }],
    ["error", "unhandled promise rejection in fetch", "node/tests/index.html", { url: "/api/data", reason: "NetworkError: Failed to fetch" }],
    ["debug", "component render cycle complete", "node/tests/index.html", { component: "Dashboard", renderMs: 34, props: { userId: "usr_7" } }],
    ["info", "client test suite finished", "node/tests/index.html", { logsEmitted: 5 }],
  ];

  for (const args of clientLogs) {
    AuraClient.log(...args);
    await sleep(150);
  }

  await sleep(800);
  await AuraClient.closeSocket(3000);
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

/** Triggers Node AuraClient (with ws polyfill) via GET /test-client. */
export async function runNodeClientTest() {
  const res = await fetch("/test-client");
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
