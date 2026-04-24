const path = require("node:path");

const { DEFAULT_TEST_PROJECT_TOKEN } = require("./harness-defaults.json");
const { AuraServer } = require(path.resolve(__dirname, "../dist/server.js"));

/**
 * @typedef {Object} AuralogParams
 * @property {string} type
 * @property {string} message
 * @property {string=} location
 * @property {unknown=} data
 */

let configured = false;

function ensureConfigured() {
  if (configured) {
    return;
  }

  const projectToken =
    process.env.NEXT_PUBLIC_AURALOGGER_PROJECT_TOKEN ||
    process.env.VITE_AURALOGGER_PROJECT_TOKEN ||
    process.env.AURALOGGER_PROJECT_TOKEN ||
    DEFAULT_TEST_PROJECT_TOKEN;
  const userSecret = process.env.AURALOGGER_USER_SECRET || "";

  AuraServer.configure(projectToken, userSecret);
  configured = true;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Server-only: uses project token + user secret from env. Do not import from client components. */
function AuraLog(params) {
  ensureConfigured();
  AuraServer.log(params.type, params.message, params.location, params.data);
}

/** Mirrors cli server burst + close so batched server traffic flushes. */
async function runServerTest() {
  ensureConfigured();

  AuraLog({
    type: "info",
    message: "server test suite started",
    location: "node/tests/local-server.js:/test",
    data: { source: "test-api-route", env: "test" },
  });

  AuraLog({
    type: "warn",
    message: "rate limit threshold approaching",
    location: "node/tests/local-server.js:/test",
    data: { currentRate: 480, limit: 500, unit: "req/min" },
  });

  AuraLog({
    type: "error",
    message: "failed to connect to upstream service",
    location: "node/tests/local-server.js:/test",
    data: { service: "auth-api", statusCode: 503, retries: 3 },
  });

  AuraLog({
    type: "debug",
    message: "request payload parsed successfully",
    location: "node/tests/local-server.js:/test",
    data: { userId: "usr_42", action: "login", durationMs: 12 },
  });

  AuraLog({
    type: "info",
    message: "server test suite finished",
    location: "node/tests/local-server.js:/test",
    data: { logsEmitted: 5 },
  });

  await sleep(800);
  await AuraServer.closeSocket(3000);
}

module.exports = {
  AuraLog,
  AuraServer,
  runServerTest,
};
