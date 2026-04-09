import WebSocket from "ws";
import chalk from "chalk";

import { resolveWsBaseUrl } from "../../utils/backend-origin";
import {
  CLIENT_CHECK_START_PETER_ASIDES,
  CLIENT_CHECK_SUCCESS_ASIDES,
  pickAside,
  ENV_RECOVERY_HINT_PLAIN,
} from "../utility/aside-pools";
import { loadCliEnvFiles } from "../utility/cli-load-env";
import { maybePrintGenericSpice, printAside } from "../utility/cli-tone";
import { resolveProjectContextForCliChecks } from "./init";

const CONNECT_TIMEOUT_MS = 5000;

function buildClientWsUrl(projectToken: string): string {
  return `${resolveWsBaseUrl()}/${encodeURIComponent(projectToken)}/create_browser_logs`;
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

/**
 * Same auth path as `server-check`: project token (env or prompt) + `proj_auth`
 * for session hydration. Browser ingest is path-only auth via `{proj_token}`.
 */
export async function runClientCheck(): Promise<void> {
  loadCliEnvFiles();
  const { projectToken, projectId, projectName, session } =
    await resolveProjectContextForCliChecks();

  const wsUrl = buildClientWsUrl(projectToken);
  console.log(
    chalk.dim("🌐 ") +
      chalk.white("Trying the ") +
      chalk.bold.white("browser-style") +
      chalk.white(" log tunnel (path-only socket auth)…"),
  );
  {
    const a = pickAside(CLIENT_CHECK_START_PETER_ASIDES);
    printAside(a.emoji, a.line);
  }
  await new Promise<void>((resolve, reject) => {
    const ws = new WebSocket(wsUrl);

    const timeout = setTimeout(() => {
      ws.terminate();
      reject(
        new Error(
          "Browser-style socket never connected — check network/VPN, corporate proxy, and AURALOGGER_WS_URL if custom; token must match the project. " +
            ENV_RECOVERY_HINT_PLAIN,
        ),
      );
    }, CONNECT_TIMEOUT_MS);

    ws.once("open", () => {
      clearTimeout(timeout);

      const nowMs = Date.now();
      const payload = {
        type: "info",
        message: "this is from cli client-check",
        location: "cli/client-check",
        session,
        created_at: createIsoTimestampWithMicroseconds(nowMs),
        data: JSON.stringify({ kind: "client-check" }),
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
      reject(
        new Error(
          `Browser tunnel error (${error.message}). Same fixes as timeout: network, proxy, env in the right cwd, then rerun. ${ENV_RECOVERY_HINT_PLAIN}`,
        ),
      );
    });
  });

  console.log("");
  const projectLabel = projectName || projectId;
  console.log(
    chalk.green("🎉 ") +
      chalk.white("Browser-style path works — test log zoomed for project ") +
      chalk.hex("#ffa657")(projectLabel) +
      chalk.white("."),
  );
  {
    const a = pickAside(CLIENT_CHECK_SUCCESS_ASIDES);
    printAside(a.emoji, a.line);
  }
  maybePrintGenericSpice();
}
