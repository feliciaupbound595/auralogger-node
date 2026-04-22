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
  const projectToken = "kGKyvNjeI4mDAm3E5NzUL65uyzNNlriEPvcQZuOxCVC4PjA9Xyw9sfLBOQRgfdoXsb2oogx0mMCmQ/Uo"
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
    message: "client test suite started",
    location: "node/tests/index.html",
    data: { source: "test-page-client", browser: navigator?.userAgent ?? "unknown" },
  });

  Auralog({
    type: "warn",
    message: "localStorage quota nearing limit",
    location: "node/tests/index.html",
    data: { usedKB: 4800, limitKB: 5120 },
  });

  Auralog({
    type: "error",
    message: "unhandled promise rejection in fetch",
    location: "node/tests/index.html",
    data: { url: "/api/data", reason: "NetworkError: Failed to fetch" },
  });

  Auralog({
    type: "debug",
    message: "component render cycle complete",
    location: "node/tests/index.html",
    data: { component: "Dashboard", renderMs: 34, props: { userId: "usr_7" } },
  });
}

module.exports = {
  Auralog,
  runClientTest,
};
