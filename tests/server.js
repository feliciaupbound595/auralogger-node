const path = require("node:path");

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
  if (configured) return;

  // You can also pass string literals to AuraServer.configure(...) instead of process.env (never commit real secrets).
  const projectToken = "9g/mr4Q0MSxD8Yc0k19WK+B6BLnj0t8nGva1RLD/E4i+7zSMoMpTbCqr9FSZ3Q6fX6o4eUGysUaf5jax";
  if (!projectToken) {
    throw new Error("Missing AURALOGGER_PROJECT_TOKEN");
  }
  const userSecret = "MC4CAQAwBQYDK2VuBCIEIEcy7NQ8x18+heO39XaGWITwOeTCYtoaMsX6jNjlckGI"
  if (!userSecret) {
    throw new Error("Missing AURALOGGER_USER_SECRET");
  }

  AuraServer.configure(projectToken, userSecret);
  configured = true;
}

/** Server-only: uses project token + user secret from env. Do not import from client components. */
function AuraLog(params) {
  ensureConfigured();
  AuraServer.log(params.type, params.message, params.location, params.data);
}

function runServerTest() {
  AuraLog({
    type: "info",
    message: "new server tests",
    location: "node/tests/local-server.js:/test",
    data: { source: "test-api-route" },
  });
}

module.exports = {
  AuraLog,
  runServerTest,
};
