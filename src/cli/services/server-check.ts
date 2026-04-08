import WebSocket from "ws";
import chalk from "chalk";

import { resolveWsBaseUrl } from "../../utils/backend-origin";
import { loadCliEnvFiles } from "../utility/cli-load-env";
import { printAside } from "../utility/cli-tone";
import { resolveProjectContextForCliChecks } from "./init";

const CONNECT_TIMEOUT_MS = 5000;

function buildWsUrl(projectId: string): string {
  return `${resolveWsBaseUrl()}/${encodeURIComponent(projectId)}/create_log`;
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
  const { projectToken, userSecret, projectId, session } =
    await resolveProjectContextForCliChecks();

  const wsUrl = buildWsUrl(projectId);
  console.log(
    chalk.dim("📡 ") +
      chalk.white("Pinging the ") +
      chalk.bold.white("server") +
      chalk.white(" logger — one tiny test log coming up…"),
  );
  printAside("🛡️", "Rogers: Shield's up — your secret is the vibranium badge on this socket.");
  await new Promise<void>((resolve, reject) => {
    const ws = new WebSocket(wsUrl, {
      headers: {
        secret: projectToken,
        user_secret: userSecret,
      },
    });

    const timeout = setTimeout(() => {
      ws.terminate();
      reject(
        new Error(
          "Gave up waiting for the server logger — still quiet. Check network / firewall / VPN vibes.",
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
      reject(
        new Error(`Server pipe wouldn't open — ${error.message}`),
      );
    });
  });

  console.log("");
  console.log(
    chalk.green("🎉 ") +
      chalk.white("Server logger is alive — a test log just took off for project ") +
      chalk.hex("#ffa657")(projectId) +
      chalk.white("."),
  );
  printAside("⚡", "Thor: The Bifrost fired — if Asgard's quiet, blame Heimdall's Wi‑Fi, not the swing.");
}
