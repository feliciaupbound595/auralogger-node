const path = require("node:path");

const { AuraClient } = require(path.resolve(__dirname, "../dist/client.js"));

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

  // AuraClient.configure() only needs the project token — never put the user secret in client bundles.
  // You can also use hardcoded strings instead of env lookups below (avoid committing real values).
  const projectToken = "9g/mr4Q0MSxD8Yc0k19WK+B6BLnj0t8nGva1RLD/E4i+7zSMoMpTbCqr9FSZ3Q6fX6o4eUGysUaf5jax"
  if (!projectToken) {
    throw new Error("Missing NEXT_PUBLIC_AURALOGGER_PROJECT_TOKEN");
  }
  AuraClient.configure(projectToken);
  configured = true;
}

/** Browser-safe: project token only. Never include user secret in client bundles. */
function Auralog(params) {
  console.log("Auralog from client initiated", params);
  ensureConfigured();
  AuraClient.log(params.type, params.message, params.location, params.data);
}

function runClientTest() {
  Auralog({
    type: "info",
    message: "new client tests",
    location: "node/tests/index.html",
    data: { source: "test-page-client" },
  });
}

module.exports = {
  Auralog,
  runClientTest,
};
