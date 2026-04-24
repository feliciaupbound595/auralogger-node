const path = require("node:path");
const WebSocket = require("ws");

const { DEFAULT_TEST_PROJECT_TOKEN } = require("./harness-defaults.json");
const { AuraClient } = require(path.resolve(__dirname, "../dist/client.js"));

/**
 * @typedef {Object} AuralogParams
 * @property {string} type
 * @property {string} message
 * @property {string=} location
 * @property {unknown=} data
 */

function ensureWebSocketPolyfill() {
  const root = globalThis;
  if (typeof root.WebSocket !== "function") {
    root.WebSocket = WebSocket;
  }
}

let configured = false;

function resolveProjectToken() {
  const token =
    process.env.NEXT_PUBLIC_AURALOGGER_PROJECT_TOKEN ||
    process.env.VITE_AURALOGGER_PROJECT_TOKEN ||
    process.env.AURALOGGER_PROJECT_TOKEN ||
    DEFAULT_TEST_PROJECT_TOKEN;
  return String(token).trim();
}

function ensureConfigured() {
  if (configured) {
    return;
  }
  AuraClient.configure(resolveProjectToken());
  configured = true;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Browser-safe pattern for params; in Node this still only uses the project token from env. */
function Auralog(params) {
  ensureWebSocketPolyfill();
  ensureConfigured();
  AuraClient.log(params.type, params.message, params.location, params.data);
}

/**
 * Same shape as cli `runTestClientlog`: patch `ws`, emit a short burst, then close the socket so batches flush.
 * @returns {Promise<void>}
 */
async function runClientTest() {
  ensureWebSocketPolyfill();
  ensureConfigured();

  const clientLogs = [
    ["info", "client test suite started", "node/tests/client.js", { source: "node-tests", env: "node" }],
    ["warn", "localStorage quota nearing limit", "node/tests/client.js", { usedKB: 4800, limitKB: 5120 }],
    ["error", "unhandled promise rejection in fetch", "node/tests/client.js", { url: "/api/data", reason: "NetworkError: Failed to fetch" }],
    ["debug", "component render cycle complete", "node/tests/client.js", { component: "Dashboard", renderMs: 34, props: { userId: "usr_7" } }],
    ["info", "client test suite finished", "node/tests/client.js", { logsEmitted: 5 }],
  ];

  for (const args of clientLogs) {
    AuraClient.log(...args);
    await sleep(150);
  }

  await sleep(800);
  await AuraClient.closeSocket(3000);
}

module.exports = {
  AuraClient,
  Auralog,
  runClientTest,
};
