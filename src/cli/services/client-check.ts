import WebSocket from "ws";
import chalk from "chalk";

import { resolveWsBaseUrl } from "../../utils/backend-origin";
import { loadCliEnvFiles } from "../utility/cli-load-env";
import { printAside } from "../utility/cli-tone";
import { resolveProjectContextForCliChecks } from "./init";

const CONNECT_TIMEOUT_MS = 5000;

function buildClientWsUrl(projectId: string): string {
  return `${resolveWsBaseUrl()}/${encodeURIComponent(projectId)}/create_browser_logs`;
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
 * for id/session. The browser ingest socket authenticates with
 * `Authorization: Bearer <projectToken>`.
 */
export async function runClientCheck(): Promise<void> {
  loadCliEnvFiles();
  const { projectToken, projectId, session } = await resolveProjectContextForCliChecks();

  const wsUrl = buildClientWsUrl(projectId);
  console.log(
    chalk.dim("🌐 ") +
      chalk.white("Trying the ") +
      chalk.bold.white("browser-style") +
      chalk.white(" log tunnel (Bearer-auth socket handshake)…"),
  );
  printAside(
    "🕷️",
    "Parker at the airport: They gave me the suit — not the Stark login. Socket hops in without the secret.",
  );
  await new Promise<void>((resolve, reject) => {
    const ws = new WebSocket(wsUrl, {
      headers: {
        authorization: `Bearer ${projectToken}`,
      },
    });

    const timeout = setTimeout(() => {
      ws.terminate();
      reject(
        new Error(
          "Browser tunnel never woke up — check network / adblock / VPN gremlins.",
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
        new Error(`Browser tunnel hiccuped — ${error.message}`),
      );
    });
  });

  console.log("");
  console.log(
    chalk.green("🎉 ") +
      chalk.white("Browser-style path works — test log zoomed for project ") +
      chalk.hex("#ffa657")(projectId) +
      chalk.white("."),
  );
  printAside(
    "🔨",
    "Vision: \"But a thing isn't beautiful because it lasts.\" — anyway, door opened; no Soul Stone required.",
  );
}
