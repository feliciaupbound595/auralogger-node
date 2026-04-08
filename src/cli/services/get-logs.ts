import chalk from "chalk";

import { resolveApiBaseUrl } from "../../utils/backend-origin";
import { tryParseResolvedStyles } from "../../utils/env-config";
import { loadCliEnvFiles } from "../utility/cli-load-env";
import { printAside } from "../utility/cli-tone";
import {
  fetchProjAuthConfig,
  resolveProjectTokenForInit,
  resolveUserSecretForInit,
} from "./init";
import { normalizeAndValidateFilters } from "./get-logs-filters";
import { parseErrorBody } from "../../utils/http-utils";
import { printLog } from "./log-print";
import { parseCommand } from "../utility/parser";

interface LogRow {
  created_at?: unknown;
  type?: unknown;
  location?: unknown;
  message?: unknown;
  data?: unknown;
}

interface LogsResponseBody {
  logs?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isLogRow(value: unknown): value is LogRow {
  return isRecord(value);
}

async function fetchLogsWithFallback(
  baseUrl: string,
  projectToken: string,
  userSecret: string,
  filters: unknown,
): Promise<LogsResponseBody> {
  const route = `${baseUrl}/api/logs`;

  const requestBody = JSON.stringify({ filters });
  const requestInit: RequestInit = {
    method: "POST",
    headers: {
      secret: projectToken,
      user_secret: userSecret,
      "content-type": "application/json",
    },
    body: requestBody,
  };

  const response = await fetch(route, requestInit).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Can't reach Auralogger to fetch logs — check connection and try again. (${message})`,
    );
  });

  if (!response.ok) {
    throw new Error(await parseErrorBody(response));
  }

  const body: unknown = await response.json().catch(() => {
    throw new Error("The log list came back garbled (not JSON). Try again?");
  });
  if (!isRecord(body)) {
    throw new Error("The log list didn’t look right. Weird — try again.");
  }
  return body;
}

export function formatGetLogsHelp(): string {
  return [
    "🔍 Filter syntax (get-logs):",
    "  -<field> [--<op>] <json-value-token>",
    "",
    "Value rules:",
    "  - maxcount, skip: JSON number (e.g. 50)",
    "  - everything else: JSON array (e.g. [\"error\",\"warn\"])",
    "",
    "Examples:",
    "  auralogger get-logs -type '[\"error\",\"warn\"]' -maxcount 50",
    "  auralogger get-logs -message '[\"timeout\"]' -skip 20 -maxcount 30",
    "  auralogger get-logs -type --not-in '[\"info\",\"debug\"]' -time --since '[\"10m\"]'",
    "  auralogger get-logs -data.userId '[\"06431f39-55e2-4289-80c8-5d0340a8b66e\"]'",
  ].join("\n");
}

export async function runGetLogsCore(
  projectToken: string,
  userSecret: string,
  configStyles: unknown,
  argv: string[],
): Promise<void> {
  let filters: unknown;
  try {
    const parsed = parseCommand(argv);
    filters = normalizeAndValidateFilters(parsed.filters);
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    throw new Error(`${msg}\n\n${formatGetLogsHelp()}`);
  }

  const baseUrl = resolveApiBaseUrl();
  const body = await fetchLogsWithFallback(baseUrl, projectToken, userSecret, filters);

  const logsRaw = body.logs;
  const logs = Array.isArray(logsRaw) ? logsRaw : [];
  if (logs.length === 0) {
    console.log(
      chalk.yellow("👻 ") +
        chalk.white("Nothing matched — loosen the filters or it’s genuinely quiet."),
    );
    printAside(
      "🪐",
      "Drax: Why is Gamora? …I mean why is NOTHING? Loosen filters or emptiness wins.",
    );
    return;
  }

  let printed = 0;
  for (const item of logs) {
    if (isLogRow(item)) {
      printLog(item, configStyles);
      printed += 1;
    }
  }
  if (printed > 0) {
    printAside(
      "🎮",
      `Tony, peeking: "That man is playing Galaga!" — you just pulled ${printed} high score${printed === 1 ? "" : "s"} from the past.`,
    );
  }
}

async function resolveGetLogsAuth(): Promise<{
  projectToken: string;
  userSecret: string;
  styles: unknown;
}> {
  loadCliEnvFiles();
  const projectToken = await resolveProjectTokenForInit();
  const userSecret = await resolveUserSecretForInit();
  const stylesFromEnv = tryParseResolvedStyles();
  if (stylesFromEnv !== null) {
    return { projectToken, userSecret, styles: stylesFromEnv };
  }

  const payload = await fetchProjAuthConfig(projectToken);
  console.log(
    chalk.hex("#79c0ff")("🎨 ") +
      chalk.white("No styles in your shell — using freshly fetched styling for this run."),
  );
  printAside(
    "🦾",
    "Rhodey: Next time, baby. — run init when you want the full War Machine paint on styles.",
  );
  return { projectToken, userSecret, styles: payload.styles };
}

export async function runGetLogs(argv: string[]): Promise<void> {
  console.log(
    chalk.bold.hex("#79c0ff")("📜 ") + chalk.white("get-logs — opening the archive…"),
  );
  printAside(
    "🕶️",
    "Fury: Last time I trusted someone I lost an eye — you steer the filters; secrets hide in headers.",
  );
  const { projectToken, userSecret, styles } = await resolveGetLogsAuth();
  await runGetLogsCore(projectToken, userSecret, styles, argv);
}
