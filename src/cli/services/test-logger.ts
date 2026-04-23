import WebSocket from "ws";
import chalk from "chalk";

import { AuraClient } from "../../client/client-log";
import { AuraServer } from "../../server/server-log";
import { Auralogger } from "../..";
import {
  pickAside,
  pickTestServerlogSuccessAside,
  TEST_CLIENTLOG_START_ASIDES,
  TEST_CLIENTLOG_SUCCESS_ASIDES,
  TEST_SERVERLOG_START_BANNER_ASIDES,
} from "../utility/aside-pools";
import { maybePrintGenericSpice, printAside } from "../utility/cli-tone";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function runTestServerlog(): Promise<void> {
  console.log(
    chalk.bold.hex("#79c0ff")("🧪 ") +
      chalk.white("Firing the ") +
      chalk.bold.white("server") +
      chalk.white(" logger — 5 peppy test logs incoming."),
  );
  {
    const a = pickAside(TEST_SERVERLOG_START_BANNER_ASIDES);
    printAside(a.emoji, a.line);
  }
  console.log("");

  const serverLogs: Array<Parameters<typeof AuraServer.log>> = [
    ["info",  "server test suite started",               "cli/test-serverlog", { env: "test", source: "auralogger-cli" }],
    ["debug", "request payload parsed successfully",      "cli/test-serverlog", { userId: "usr_42", action: "login", durationMs: 12 }],
    ["warn",  "rate limit threshold approaching",         "cli/test-serverlog", { currentRate: 480, limit: 500, unit: "req/min" }],
    ["error", "failed to connect to upstream service",    "cli/test-serverlog", { service: "auth-api", statusCode: 503, retries: 3 }],
    ["info",  "server test suite finished",               "cli/test-serverlog", { logsEmitted: 5 }],
  ];
  for (const args of serverLogs) {
    AuraServer.log(...args);
    await sleep(150);
  }

  await sleep(800);
  await AuraServer.closeSocket(3000);
  console.log("");
  console.log(
    chalk.green("✅ ") +
      chalk.white("Server burst sent. Peek with ") +
      chalk.hex("#79c0ff")("auralogger get-logs -maxcount 20") +
      chalk.white(" if the dashboard’s shy."),
  );
  {
    const a = pickTestServerlogSuccessAside();
    printAside(a.emoji, a.line);
  }
  maybePrintGenericSpice();
}

export async function runTestClientlog(): Promise<void> {
  const root = globalThis as typeof globalThis & { WebSocket?: unknown };
  if (typeof root.WebSocket !== "function") {
    (root as { WebSocket: typeof WebSocket }).WebSocket = WebSocket;
  }

  console.log(
    chalk.bold.hex("#79c0ff")("🧪 ") +
      chalk.white("Firing the ") +
      chalk.bold.white("client") +
      chalk.white(" logger — 5 test logs, browser flavor."),
  );
  console.log(chalk.dim("   (Patches in `ws` so Node can fake a browser here.)"));
  {
    const a = pickAside(TEST_CLIENTLOG_START_ASIDES);
    printAside(a.emoji, a.line);
  }
  console.log("");

  const clientLogs: Array<Parameters<typeof AuraClient.log>> = [
    ["info",  "client test suite started",                    "cli/test-clientlog", { source: "auralogger-cli", env: "test" }],
    ["warn",  "localStorage quota nearing limit",             "cli/test-clientlog", { usedKB: 4800, limitKB: 5120 }],
    ["error", "unhandled promise rejection in fetch",         "cli/test-clientlog", { url: "/api/data", reason: "NetworkError: Failed to fetch" }],
    ["debug", "component render cycle complete",              "cli/test-clientlog", { component: "Dashboard", renderMs: 34, props: { userId: "usr_7" } }],
    ["info",  "client test suite finished",                   "cli/test-clientlog", { logsEmitted: 5 }],
  ];
  for (const args of clientLogs) {
    AuraClient.log(...args);
    await sleep(150);
  }

  await sleep(800);
  await AuraClient.closeSocket(3000);
  console.log("");
  console.log(
    chalk.green("✅ ") +
      chalk.white("Client burst sent. Spy with ") +
      chalk.hex("#79c0ff")("auralogger get-logs -maxcount 20") +
      chalk.white(" when curious."),
  );
  {
    const a = pickAside(TEST_CLIENTLOG_SUCCESS_ASIDES);
    printAside(a.emoji, a.line);
  }
  maybePrintGenericSpice();
}

export async function runTestLog(): Promise<void> {
  const root = globalThis as typeof globalThis & { WebSocket?: unknown };
  if (typeof root.WebSocket !== "function") {
    (root as { WebSocket: typeof WebSocket }).WebSocket = WebSocket;
  }

  console.log(
    chalk.bold.hex("#79c0ff")("🧪 ") +
      chalk.white("Firing the ") +
      chalk.bold.white("index") +
      chalk.white(" Auralogger client — 5 test logs, browser flavor."),
  );
  console.log(chalk.dim("   (Uses the package index export; hits the no-auth browser socket.)"));
  {
    const a = pickAside(TEST_CLIENTLOG_START_ASIDES);
    printAside(a.emoji, a.line);
  }
  console.log("");

  const logs: Array<Parameters<typeof Auralogger.log>> = [
    ["info",  "test-log suite started",                       "cli/test-log", { source: "auralogger-cli", env: "test" }],
    ["warn",  "localStorage quota nearing limit",             "cli/test-log", { usedKB: 4800, limitKB: 5120 }],
    ["error", "unhandled promise rejection in fetch",         "cli/test-log", { url: "/api/data", reason: "NetworkError: Failed to fetch" }],
    ["debug", "component render cycle complete",              "cli/test-log", { component: "Dashboard", renderMs: 34, props: { userId: "usr_7" } }],
    ["info",  "test-log suite finished",                      "cli/test-log", { logsEmitted: 5 }],
  ];
  for (const args of logs) {
    Auralogger.log(...args);
    await sleep(150);
  }

  await sleep(800);
  await Auralogger.closeSocket(3000);
  console.log("");
  console.log(
    chalk.green("✅ ") +
      chalk.white("Index client burst sent. Spy with ") +
      chalk.hex("#79c0ff")("auralogger get-logs -maxcount 20") +
      chalk.white(" when curious."),
  );
  {
    const a = pickAside(TEST_CLIENTLOG_SUCCESS_ASIDES);
    printAside(a.emoji, a.line);
  }
  maybePrintGenericSpice();
}
