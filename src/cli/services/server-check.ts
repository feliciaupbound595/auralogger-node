import WebSocket from "ws";
import chalk from "chalk";

import { resolveWsBaseUrl } from "../../utils/backend-origin";
import {
  CHECK_RETRY_ASIDES,
  pickAside,
  ENV_RECOVERY_HINT_PLAIN,
  SERVER_CHECK_FAIL_WOLVERINE_ASIDES,
  SERVER_CHECK_OPEN_ASIDES,
  SERVER_CHECK_SUCCESS_THOR_ASIDES,
} from "../utility/aside-pools";
import { loadCliEnvFiles } from "../utility/cli-load-env";
import { maybePrintGenericSpice, printAside } from "../utility/cli-tone";
import { resolveProjectContextForCliChecks } from "./init";

const CONNECT_TIMEOUT_MS = 5000;
const MAX_RETRIES = 2;
const RETRY_WAIT_MS = 700;

function buildWsUrl(projectToken: string): string {
  return `${resolveWsBaseUrl()}/${encodeURIComponent(projectToken)}/create_log`;
}

function padMicros(microseconds: number): string {
  return String(microseconds).padStart(6, "0");
}

function createIsoTimestampWithMicroseconds(epochMs: number): string {
  const d = new Date(epochMs);
  const iso = d.toISOString();
  const micros = padMicros(d.getUTCMilliseconds() * 1_000);
  return `${iso.slice(0, 19)}.${micros}Z`;
}

export async function runServerCheck(): Promise<void> {
  loadCliEnvFiles();
  const { projectToken, userSecret, projectId, projectName, session } =
    await resolveProjectContextForCliChecks();

  const wsUrl = buildWsUrl(projectToken);
  console.log(
    chalk.dim("📡 ") +
      chalk.white("Pinging the ") +
      chalk.bold.white("server") +
      chalk.white(" logger — one tiny test log coming up…"),
  );
  {
    const a = pickAside(SERVER_CHECK_OPEN_ASIDES);
    printAside(a.emoji, a.line);
  }
  const sendAttempt = async (): Promise<void> =>
    new Promise<void>((resolve, reject) => {
    const ws = new WebSocket(wsUrl, {
      headers: {
        authorization: `Bearer ${userSecret}`,
      },
    });

    const timeout = setTimeout(() => {
      ws.terminate();
      {
        const w = pickAside(SERVER_CHECK_FAIL_WOLVERINE_ASIDES);
        printAside(w.emoji, w.line);
      }
      reject(
        new Error(
          "Server logger socket didn't open in time — still quiet. Check VPN/Wi‑Fi, firewall, AURALOGGER_WS_URL if you override it, and that token + user secret match this project. " +
            ENV_RECOVERY_HINT_PLAIN,
        ),
      );
    }, CONNECT_TIMEOUT_MS);

    ws.once("open", () => {
      clearTimeout(timeout);

      const nowMs = Date.now();
      const payload = {
        type: "info",
        message: "this is from cli server-check",
        location: "cli/server-check",
        session,
        created_at: createIsoTimestampWithMicroseconds(nowMs),
        data: JSON.stringify({ kind: "server-check" }),
      };

      let sendPayload = "";
      try {
        sendPayload = JSON.stringify(payload);
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        ws.close();
        reject(new Error(`Couldn't pack the test log: ${msg}`));
        return;
      }

      ws.send(sendPayload, (error?: Error) => {
        if (error) {
          ws.close();
          reject(
            new Error(`Log didn't send — ${error.message}`),
          );
          return;
        }

        ws.close();
        resolve();
      });
    });

    ws.once("error", (error: Error) => {
      clearTimeout(timeout);
      {
        const w = pickAside(SERVER_CHECK_FAIL_WOLVERINE_ASIDES);
        printAside(w.emoji, w.line);
      }
      reject(
        new Error(
          `Server pipe wouldn't open (${error.message}). Verify creds in .env, run from the folder that loads them, then try again. ${ENV_RECOVERY_HINT_PLAIN}`,
        ),
      );
    });
    });

  for (let attempt = 1; attempt <= MAX_RETRIES + 1; attempt += 1) {
    try {
      await sendAttempt();
      break;
    } catch (error: unknown) {
      if (attempt > MAX_RETRIES) {
        throw error;
      }
      const retryCount = attempt;
      console.log("");
      const a = pickAside(CHECK_RETRY_ASIDES);
      printAside(a.emoji, a.line);
      console.log(
        chalk.dim("🔁 ") +
          chalk.white("Retrying ") +
          chalk.bold.white("server-check") +
          chalk.white(` (attempt ${retryCount + 1}/${MAX_RETRIES + 1})...`),
      );
      await new Promise((r) => setTimeout(r, RETRY_WAIT_MS));
    }
  }

  console.log("");
  const projectLabel = projectName || projectId;
  console.log(
    chalk.green("🎉 ") +
      chalk.white("Server logger is alive — a test log just took off for project ") +
      chalk.hex("#ffa657")(projectLabel) +
      chalk.white("."),
  );
  {
    const a = pickAside(SERVER_CHECK_SUCCESS_THOR_ASIDES);
    printAside(a.emoji, a.line);
  }
  maybePrintGenericSpice();
}
