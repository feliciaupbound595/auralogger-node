import chalk from "chalk";

import { buildProjectLogsUrl, resolveApiBaseUrl } from "../../utils/backend-origin";
import {
  getResolvedProjectToken,
  getResolvedSession,
  getResolvedUserSecret,
  tryParseResolvedStyles,
} from "../../utils/env-config";
import {
  formatAsideTemplate,
  GET_LOGS_EMPTY_ASIDES,
  GET_LOGS_OPEN_ASIDES,
  GET_LOGS_SKIPPED_SETUP_INTENT_ASIDES,
  GET_LOGS_SUCCESS_TEMPLATES,
  pickAside,
  ENV_RECOVERY_HINT_PLAIN,
} from "../utility/aside-pools";
import { loadCliEnvFiles } from "../utility/cli-load-env";
import { getSuccessfulRunCount } from "../utility/cli-personality-state";
import { maybePrintGenericSpice, printAside, printAsideMaybe } from "../utility/cli-tone";
import {
  fetchProjAuthConfig,
  resolveProjectTokenForInit,
  resolveUserSecretForInit,
} from "./init";
import { normalizeAndValidateFilters, withDefaultSessionFilter } from "./get-logs-filters";
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
): Promise<{ body: LogsResponseBody; logsEndpointNotFound: boolean }> {
  const route = buildProjectLogsUrl(baseUrl, projectToken);

  const requestBody = JSON.stringify({ filters });
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (userSecret) {
    headers["secret"] = userSecret;
    headers["user_secret"] = userSecret;
  }
  const requestInit: RequestInit = {
    method: "POST",
    headers,
    body: requestBody,
  };

  const response = await fetch(route, requestInit).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Can't reach Auralogger to fetch logs — check connection and try again. (${message}) ${ENV_RECOVERY_HINT_PLAIN}`,
    );
  });

  if (!response.ok) {
    if (response.status === 404) {
      console.log(
        chalk.yellow("⚠️ ") +
          chalk.white("POST ") +
          chalk.dim("/api/{project_token}/logs") +
          chalk.white(
            " returned 404 — wrong API host, old backend, or route not deployed. ",
          ) +
          chalk.dim("Check ") +
          chalk.cyan("AURALOGGER_API_URL") +
          chalk.dim("."),
      );
      return { body: { logs: [] }, logsEndpointNotFound: true };
    }
    const body = await parseErrorBody(response);
    const authish = response.status === 401 || response.status === 403;
    throw new Error(authish ? `${body} ${ENV_RECOVERY_HINT_PLAIN}` : body);
  }

  const body: unknown = await response.json().catch(() => {
    throw new Error("The log list came back garbled (not JSON). Try again?");
  });
  if (!isRecord(body)) {
    throw new Error("The log list didn’t look right. Weird — try again.");
  }
  return { body, logsEndpointNotFound: false };
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
    filters = withDefaultSessionFilter(
      normalizeAndValidateFilters(parsed.filters),
      getResolvedSession(),
    );
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    throw new Error(`${msg}\n\n${formatGetLogsHelp()}`);
  }

  const baseUrl = resolveApiBaseUrl();
  const { body, logsEndpointNotFound } = await fetchLogsWithFallback(
    baseUrl,
    projectToken,
    userSecret,
    filters,
  );

  const logsRaw = body.logs;
  const logs = Array.isArray(logsRaw) ? logsRaw : [];
  if (logs.length === 0) {
    if (logsEndpointNotFound) {
      return;
    }
    console.log(
      chalk.yellow("👻 ") +
        chalk.white("Nothing matched — try looser filters, smaller -skip, or bigger -maxcount; if it's a new project, maybe nothing's logged yet."),
    );
    {
      const a = pickAside(GET_LOGS_EMPTY_ASIDES);
      printAside(a.emoji, a.line);
    }
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
    {
      const t = pickAside(GET_LOGS_SUCCESS_TEMPLATES);
      printAside(
        t.emoji,
        formatAsideTemplate(t.line, { n: printed }),
      );
    }
  }
}

async function resolveGetLogsAuth(): Promise<{
  projectToken: string;
  userSecret: string;
  styles: unknown;
}> {
  loadCliEnvFiles();
  const projectToken = await resolveProjectTokenForInit();
  const stylesFromEnv = tryParseResolvedStyles();
  const userSecretFromEnv = getResolvedUserSecret();
  if (userSecretFromEnv) {
    // If we already have a user secret locally, assume the encrypted path and skip proj_auth.
    // Only hit the network when we need to determine whether encryption is disabled.
    return { projectToken, userSecret: userSecretFromEnv, styles: stylesFromEnv ?? undefined };
  }

  console.log(chalk.dim("🔐 ") + chalk.white("Authenticating with Auralogger…"));

  let payload;
  try {
    payload = await fetchProjAuthConfig(projectToken);
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    // Fall through with no styles — still need to prompt for secret if we can’t determine encrypted
    console.log(
      chalk.yellow("⚠️ ") +
        chalk.white(
          `Couldn’t reach Auralogger for auth (${msg}). Using env config if available.`,
        ),
    );
    const userSecret = await resolveUserSecretForInit();
    return { projectToken, userSecret, styles: stylesFromEnv ?? undefined };
  }

  const encrypted = payload.encrypted;

  let userSecret = "";
  if (encrypted) {
    userSecret = await resolveUserSecretForInit();
  }

  return { projectToken, userSecret, styles: stylesFromEnv ?? payload.styles };
}

export async function runGetLogs(argv: string[]): Promise<void> {
  loadCliEnvFiles();
  if (!getResolvedProjectToken() && getSuccessfulRunCount("init") === 0) {
    const a = pickAside(GET_LOGS_SKIPPED_SETUP_INTENT_ASIDES);
    printAsideMaybe(a.emoji, a.line, 0.12);
  }

  console.log(
    chalk.bold.hex("#79c0ff")("📜 ") + chalk.white("get-logs — opening the archive…"),
  );
  {
    const a = pickAside(GET_LOGS_OPEN_ASIDES);
    printAsideMaybe(a.emoji, a.line, 0.12);
  }
  const { projectToken, userSecret, styles } = await resolveGetLogsAuth();
  console.log(chalk.dim("📦 ") + chalk.white("Fetching logs…"));
  await runGetLogsCore(projectToken, userSecret, styles, argv);
  maybePrintGenericSpice();
}
