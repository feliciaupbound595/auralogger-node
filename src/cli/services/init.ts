import * as readline from "node:readline/promises";
import { stdin, stdout } from "node:process";
import chalk from "chalk";

import { loadCliEnvFiles } from "../utility/cli-load-env";
import { printAside } from "../utility/cli-tone";
import { resolveApiBaseUrl } from "../../utils/backend-origin";
import {
  ENV_NEXT_PUBLIC_PROJECT_ID,
  ENV_NEXT_PUBLIC_PROJECT_SESSION,
  ENV_NEXT_PUBLIC_PROJECT_STYLES,
  ENV_PROJECT_ID,
  ENV_PROJECT_TOKEN,
  ENV_PROJECT_SESSION,
  ENV_PROJECT_STYLES,
  ENV_USER_SECRET,
  formatDotenvLine,
  getResolvedProjectId,
  getResolvedProjectToken,
  getResolvedSession,
  getResolvedUserSecret,
  tryParseResolvedStyles,
} from "../../utils/env-config";
import { parseErrorBody } from "../../utils/http-utils";
import { buildStyleEntriesFromApi } from "../utility/log-styles";
import type { ProjAuthConfigPayload } from "../utility/log-styles";

interface ProjAuthResponse {
  project_id?: string | null;
  session?: string | null;
  styles?: unknown;
}

async function promptForProjectToken(): Promise<string> {
  const cli = readline.createInterface({ input: stdin, output: stdout });

  try {
    const enteredProjectToken = await cli.question(
      chalk.cyan("🔐 ") + `Paste ${ENV_PROJECT_TOKEN} (your project token): `,
    );
    const projectToken = enteredProjectToken.trim();
    if (!projectToken) {
      throw new Error("Project token cannot be empty.");
    }
    return projectToken;
  } finally {
    cli.close();
  }
}

async function promptForUserSecret(): Promise<string> {
  const cli = readline.createInterface({ input: stdin, output: stdout });

  try {
    const enteredUserSecret = await cli.question(
      chalk.cyan("🙍 ") + `Paste ${ENV_USER_SECRET} (your user secret): `,
    );
    const userSecret = enteredUserSecret.trim();
    if (!userSecret) {
      throw new Error("User secret cannot be empty.");
    }
    return userSecret;
  } finally {
    cli.close();
  }
}

/** Project token from env or interactive prompt. */
export async function resolveProjectTokenForInit(): Promise<string> {
  const envProjectToken = getResolvedProjectToken();
  if (envProjectToken) {
    return envProjectToken;
  }
  return promptForProjectToken();
}

/** User secret from env or interactive prompt. */
export async function resolveUserSecretForInit(): Promise<string> {
  const envUserSecret = getResolvedUserSecret();
  if (envUserSecret) {
    return envUserSecret;
  }
  return promptForUserSecret();
}

export interface InitConfigPayload extends ProjAuthConfigPayload {
  project_token: string;
}

function buildConfigPayload(
  authResponse: ProjAuthResponse,
  projectToken: string,
): InitConfigPayload {
  const apiRows = Array.isArray(authResponse.styles) ? authResponse.styles : [];
  return {
    project_token: projectToken,
    project_id: authResponse.project_id ?? null,
    session: authResponse.session ?? null,
    styles: buildStyleEntriesFromApi(apiRows),
  };
}

export async function fetchProjAuthConfig(projectToken: string): Promise<InitConfigPayload> {
  const baseUrl = resolveApiBaseUrl();

  const response = await fetch(`${baseUrl}/api/proj_auth`, {
    method: "POST",
    headers: { secret: projectToken },
  }).catch((error: unknown) => {
    const msg = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Can't reach Auralogger right now — check your network or VPN, then try again. (${msg})`,
    );
  });

  if (!response.ok) {
    throw new Error(await parseErrorBody(response));
  }

  const authResponse: unknown = await response.json().catch(() => {
    throw new Error("Got a reply, but it wasn’t readable JSON. Try again in a moment.");
  });

  if (!isPlainAuthResponse(authResponse)) {
    throw new Error(
      "The reply didn’t look right. Run auralogger init again or double-check your project token.",
    );
  }

  return buildConfigPayload(authResponse, projectToken);
}

/**
 * Same credential model as `AuraServer.syncFromSecret`: only the project token
 * must be available locally; id + session come from `POST /api/proj_auth`.
 */
export async function resolveProjectContextForCliChecks(): Promise<{
  projectToken: string;
  userSecret: string;
  projectId: string;
  session: string;
}> {
  const projectToken = await resolveProjectTokenForInit();
  const userSecret = await resolveUserSecretForInit();
  const payload = await fetchProjAuthConfig(projectToken);
  const projectId = payload.project_id?.trim() ?? "";
  const session = payload.session?.trim() ?? "";
  if (!projectId || !session) {
    throw new Error(
      `${ENV_PROJECT_TOKEN} looks off, or the API didn’t return project id + session — try auralogger init.`,
    );
  }
  return { projectToken, userSecret, projectId, session };
}

function isPlainAuthResponse(value: unknown): value is ProjAuthResponse {
  return value !== null && typeof value === "object";
}

function buildAuraClientWrapperSnippet(): string {
  return [
    `import { AuraClient } from 'auralogger-cli/client'`,
    ``,
    `export type AuralogParams = {`,
    `  type: string`,
    `  message: string`,
    `  location?: string`,
    `  data?: unknown`,
    `}`,
    ``,
    `let configured = false`,
    ``,
    `function ensureConfigured(): void {`,
    `  if (configured) return`,
    ``,
    `  // You can also use hardcoded strings instead of the env lookups below (avoid committing real values; browser bundles are public).`,
    `  const projectId = process.env.NEXT_PUBLIC_AURALOGGER_PROJECT_ID`,
    `  if (!projectId) {`,
    `    throw new Error('Missing NEXT_PUBLIC_AURALOGGER_PROJECT_ID')`,
    `  }`,
    ``,
    `  AuraClient.configure({`,
    `    projectId,`,
    `    session: process.env.NEXT_PUBLIC_AURALOGGER_PROJECT_SESSION ?? null,`,
    `    styles: process.env.NEXT_PUBLIC_AURALOGGER_PROJECT_STYLES,`,
    `  })`,
    `  configured = true`,
    `}`,
    ``,
    `/** Browser-safe: no project token or user secret. Configure via NEXT_PUBLIC_AURALOGGER_* env vars. */`,
    `export function Auralog(params: AuralogParams): void {`,
    `  ensureConfigured()`,
    `  AuraClient.log(params.type, params.message, params.location, params.data)`,
    `}`,
  ].join("\n");
}

function buildAuraServerWrapperSnippet(): string {
  return [
    `import { AuraServer } from 'auralogger-cli/server'`,
    ``,
    `export type AuralogParams = {`,
    `  type: string`,
    `  message: string`,
    `  location?: string`,
    `  data?: unknown`,
    `}`,
    ``,
    `let configured = false`,
    ``,
    `function ensureConfigured(): void {`,
    `  if (configured) return`,
    ``,
    `  // You can also pass string literals to AuraServer.configure(...) instead of process.env (never commit real secrets).`,
    `  const projectToken = process.env.${ENV_PROJECT_TOKEN}`,
    `  if (!projectToken) {`,
    `    throw new Error('Missing ${ENV_PROJECT_TOKEN}')`,
    `  }`,
    `  const userSecret = process.env.${ENV_USER_SECRET}`,
    `  if (!userSecret) {`,
    `    throw new Error('Missing ${ENV_USER_SECRET}')`,
    `  }`,
    ``,
    `  AuraServer.configure(projectToken, userSecret)`,
    `  configured = true`,
    `}`,
    ``,
    `/** Server-only: uses project token + user secret from env. Do not import from client components. */`,
    `export function AuraLog(params: AuralogParams): void {`,
    `  ensureConfigured()`,
    `  AuraServer.log(params.type, params.message, params.location, params.data)`,
    `}`,
  ].join("\n");
}

function printTwoAuralogExplainer(): void {
  console.log("");
  console.log(
    chalk.bold.hex("#d2a8ff")("  🧭 ") +
      chalk.white("Two helpers, two files: client ") +
      chalk.bold.white("Auralog") +
      chalk.white(", server ") +
      chalk.bold.white("AuraLog") +
      chalk.white(" — stash each in ") +
      chalk.bold.white("its own file") +
      chalk.dim(" (or project)."),
  );
  console.log(
    chalk.gray("     ") +
      chalk.hex("#ffa657")("🎨 ") +
      chalk.bold.white("Browser / frontend") +
      chalk.gray(" — SPA, React, Vue, etc. If you want ") +
      chalk.white("fancy styled logs in DevTools") +
      chalk.gray(", that’s your crew. ") +
      chalk.dim("No secret shipped to users."),
  );
  console.log(
    chalk.gray("     ") +
      chalk.hex("#79c0ff")("🧱 ") +
      chalk.bold.white("Server / backend / CLI") +
      chalk.gray(" — APIs, workers, scripts, terminal tools: not user-facing UI. ") +
      chalk.white("The secret only exists in this server-side copy."),
  );
  console.log("");
}

function printCodeStory(title: string, snippet: string): void {
  console.log(
    chalk.bold.hex("#d2a8ff")("  📋 ") + chalk.bold.white(title),
  );
  console.log("");
  for (const line of snippet.split("\n")) {
    if (line.startsWith("import ")) {
      console.log(
        "  " + chalk.hex("#ff7b72")("import") + chalk.hex("#7ee787")(" " + line.slice(7)),
      );
    } else if (line.startsWith("export type ")) {
      console.log(
        "  " +
          chalk.hex("#ff7b72")("export type") +
          chalk.hex("#7ee787")(line.slice("export type".length)),
      );
    } else if (line.startsWith("export function ")) {
      console.log(
        "  " +
          chalk.hex("#ff7b72")("export function") +
          chalk.hex("#7ee787")(line.slice("export function".length)),
      );
    } else {
      console.log("  " + chalk.hex("#7ee787")(line));
    }
  }
  console.log("");
}

function printCopyPasteEnvBlock(
  payload: InitConfigPayload,
  projectTokenWasAlreadyInEnv: boolean,
  userSecretWasAlreadyInEnv: boolean,
  userSecret: string,
): void {
  const projectId = payload.project_id?.trim() ?? "";
  const session = payload.session?.trim() ?? "";
  const stylesJson = JSON.stringify(payload.styles ?? []);

  console.log("");
  console.log(
    chalk.bold.hex("#79c0ff")("📋 ") + chalk.bold.white("Copy-paste env block"),
  );
  console.log(
    chalk.dim(
      "   All keys and values in dotenv form — paste into .env / .env.local. For Vite, duplicate as VITE_AURALOGGER_PROJECT_* with the same values.",
    ),
  );
  console.log("");

  const lines: string[] = [];
  if (!projectTokenWasAlreadyInEnv) {
    lines.push(formatDotenvLine(ENV_PROJECT_TOKEN, payload.project_token));
  }
  if (!userSecretWasAlreadyInEnv) {
    lines.push(formatDotenvLine(ENV_USER_SECRET, userSecret));
  }
  lines.push(formatDotenvLine(ENV_NEXT_PUBLIC_PROJECT_ID, projectId));
  lines.push(formatDotenvLine(ENV_NEXT_PUBLIC_PROJECT_SESSION, session));
  lines.push(formatDotenvLine(ENV_NEXT_PUBLIC_PROJECT_STYLES, stylesJson));
  lines.push(formatDotenvLine(ENV_PROJECT_ID, projectId));
  lines.push(formatDotenvLine(ENV_PROJECT_SESSION, session));
  lines.push(formatDotenvLine(ENV_PROJECT_STYLES, stylesJson));

  for (const line of lines) {
    console.log(chalk.hex("#8b949e")(line));
  }

  if (projectTokenWasAlreadyInEnv || userSecretWasAlreadyInEnv) {
    console.log("");
    if (projectTokenWasAlreadyInEnv) {
      console.log(
        chalk.dim("   ") +
          chalk.white(ENV_PROJECT_TOKEN) +
          chalk.dim(
            " was already in your environment — omitted above; keep your existing line alongside these.",
          ),
      );
    }
    if (userSecretWasAlreadyInEnv) {
      console.log(
        chalk.dim("   ") +
          chalk.white(ENV_USER_SECRET) +
          chalk.dim(
            " was already in your environment — omitted above; keep your existing line alongside these.",
          ),
      );
    }
  }
  console.log("");
}

function printEnvInstructions(
  payload: InitConfigPayload,
  projectTokenWasAlreadyInEnv: boolean,
  userSecretWasAlreadyInEnv: boolean,
  userSecret: string,
): void {
  const styleCount = Array.isArray(payload.styles) ? payload.styles.length : 0;
  const stylesJsonLen = JSON.stringify(payload.styles).length;

  console.log("");
  console.log(
    chalk.bold.hex("#ffa657")("✨ ") +
      chalk.bold.white("Auralogger init") +
      chalk.dim(" — client pretty-logs + server secrets, coming right up."),
  );
  printAside("🎬", "Stark: \"Jarvis, warm up the lab.\" — credentials rolling in.");

  console.log("");
  console.log(
    chalk.bold.hex("#79c0ff")("🗝️  Step 1 — ") + chalk.bold.white(ENV_PROJECT_TOKEN),
  );
  if (projectTokenWasAlreadyInEnv) {
    console.log(
      chalk.gray(
        "   This variable was already in your environment, so you’re set: the ",
      ) +
        chalk.white("CLI") +
        chalk.gray(" and ") +
        chalk.white("AuraServer") +
        chalk.gray(" both read the same key — no token line printed again."),
    );
    printAside("🔐", "The vault was already open — we're not flashing the combo again.");
  } else {
    console.log(
      chalk.gray("   You typed the project token at the prompt. Use the ") +
        chalk.bold.white("copy-paste env block") +
        chalk.gray(" below (includes ") +
        chalk.white(ENV_PROJECT_TOKEN) +
        chalk.gray(
          ") in a gitignored `.env` or your host secret store so future CLI runs and AuraServer can authenticate.",
        ),
    );
    printAside("🕷️", "Parker: I talk when I'm stressed too — carve it into .env before the wrong person hears.");
  }

  console.log("");
  console.log(
    chalk.bold.hex("#79c0ff")("🎁  Step 2 — publishable trio (paste into ") +
      chalk.white("NEXT_PUBLIC_AURALOGGER_*") +
      chalk.bold.hex("#79c0ff")(" for the client helper)"),
  );
  console.log(
    chalk.gray("   ") + chalk.white("projectId") + chalk.dim(" · ") + chalk.hex("#ffa657")(payload.project_id ?? "—"),
  );
  console.log(
    chalk.gray("   ") + chalk.white("session") + chalk.dim(" · ") + chalk.hex("#ffa657")(payload.session ?? "—"),
  );
  console.log(
    chalk.gray("   ") +
      chalk.white("styles") +
      chalk.dim(" · ") +
      chalk.hex("#ffa657")(`${styleCount} entr${styleCount === 1 ? "y" : "ies"}`) +
      chalk.dim(` (${stylesJsonLen} chars of JSON vibes)`),
  );
  printAside("🕶️", "Fury: \"There was an idea…\" — two files: Auralog vs AuraLog, different battle suits.");

  console.log("");
  console.log(
    chalk.bold.hex("#79c0ff")("🧾  Step 3 — ") + chalk.bold.white(ENV_USER_SECRET),
  );
  if (userSecretWasAlreadyInEnv) {
    console.log(
      chalk.gray("   Already present in your environment — no user-secret line printed again."),
    );
  } else {
    console.log(
      chalk.gray(
        "   You typed the user secret at the prompt. It appears in the copy-paste env block below.",
      ),
    );
  }

  printCopyPasteEnvBlock(payload, projectTokenWasAlreadyInEnv, userSecretWasAlreadyInEnv, userSecret);

  console.log("");
  printTwoAuralogExplainer();
  printAside("🕷️", "Parker: \"Friendly neighborhood logger, sir!\" — DevTools go brrr, no Stark codes in the onesie.");
  printCodeStory(
    "Client-side Auralog — auralogger-cli/client",
    buildAuraClientWrapperSnippet(),
  );
  printAside("⚡", "Thor: ANOTHER! …wait, this pint's classified — Asgard-only; Midgard bundles stay thirsty.");
  printCodeStory(
    "Server-side AuraLog — auralogger-cli/server",
    buildAuraServerWrapperSnippet(),
  );

  console.log(
    chalk.bold.hex("#f85149")("🙅 ") +
      chalk.white("Never put ") +
      chalk.bold.white(ENV_PROJECT_TOKEN) +
      chalk.white(" in frontend bundles — only the ") +
      chalk.bold.white("server") +
      chalk.white(" AuraLog file gets that."),
  );
  console.log(
    chalk.gray("   The ") + chalk.bold.gray("client") + chalk.gray(" Auralog is chill: pretty logs, zero skeleton keys."),
  );
  printAside("🕷️", "Ben: With great power comes great responsibility — and zero secrets in the client bundle. Memorize that.");
  console.log("");
}

function printAlreadyConfiguredSuccess(): void {
  if (!tryParseResolvedStyles()) {
    return;
  }

  console.log("");
  console.log(
    chalk.bold.hex("#ffa657")("🎉 ") +
      chalk.white("Plot twist — this shell already has id, session, and styles."),
  );
  console.log(
    chalk.gray(
      "   Drop-in helpers below — client reads NEXT_PUBLIC_* from your bundler; server still uses token + user secret from env.",
    ),
  );
  printAside("🔮", "Strange: I ran futures — this timeline's boring; your shell already knows the spell.");
  console.log("");
  printTwoAuralogExplainer();
  printAside("🕷️", "Peter: \"New car smell!\" — client Auralog: shiny logs, not the nuclear football.");
  printCodeStory(
    "Client-side Auralog — auralogger-cli/client",
    buildAuraClientWrapperSnippet(),
  );
  printAside("🛡️", "Barnes energy: \"I'm with you 'til the end of the line.\" — server file keeps the secret in the trench.");
  printCodeStory(
    "Server-side AuraLog — auralogger-cli/server",
    buildAuraServerWrapperSnippet(),
  );
  console.log(
    chalk.dim("   Need a remixed session/styles? Unset those vars, then "),
    chalk.hex("#79c0ff")("auralogger init"),
    chalk.dim(" again."),
  );
  printAside("🐍", "Loki: Glorious purpose? Wipe session/styles, run init — blame the TVA if HR asks.");
  console.log(
    chalk.dim("   Victory lap for the server pipe: "),
    chalk.hex("#79c0ff")("auralogger server-check"),
  );
  printAside(
    "🛡️",
    'Rogers: "I can do this all day." — run server-check: one stubborn ping for Peggy.',
  );
  console.log("");
}

export async function runInit(): Promise<void> {
  loadCliEnvFiles();

  const hasProjectToken = Boolean(getResolvedProjectToken());
  const projectTokenWasAlreadyInEnv = hasProjectToken;
  const hasUserSecret = Boolean(getResolvedUserSecret());
  const userSecretWasAlreadyInEnv = hasUserSecret;
  const hasProjectId = Boolean(getResolvedProjectId());
  const hasSession = Boolean(getResolvedSession());
  const hasStyles = tryParseResolvedStyles() !== null;

  if (hasProjectToken && hasUserSecret && hasProjectId && hasSession && hasStyles) {
    printAlreadyConfiguredSuccess();
    return;
  }

  if (hasProjectToken && !hasProjectId && !hasSession && !hasStyles) {
    console.log(
      chalk.dim("🔎 ") +
        chalk.white(`Spotted ${ENV_PROJECT_TOKEN} — grabbing the rest from home base…`),
    );
    printAside("🔮", "Strange: \"We're in the endgame now.\" — fetching id, session, styles from the sky.");
  }

  const projectToken = await resolveProjectTokenForInit();
  const userSecret = await resolveUserSecretForInit();
  const payload = await fetchProjAuthConfig(projectToken);
  printEnvInstructions(payload, projectTokenWasAlreadyInEnv, userSecretWasAlreadyInEnv, userSecret);
  console.log(
    chalk.hex("#ffa657")("🎬 ") +
      chalk.dim("Curtain call: ") +
      chalk.hex("#79c0ff")("auralogger server-check") +
      chalk.dim(" when the server pipe should flex too."),
  );
  printAside("🎬", "Stark: Go be a \"genius, logger, playboy philanthropist\" — we'll see you in telemetry.");
  console.log("");
}
