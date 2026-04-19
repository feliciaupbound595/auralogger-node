import * as readline from "node:readline/promises";
import { stdin, stdout } from "node:process";
import chalk from "chalk";

import {
  INIT_ALREADY_LOKI_ASIDES,
  INIT_ALREADY_STEVE_ASIDES,
  INIT_ALREADY_STRANGE_ASIDES,
  INIT_CURTAIN_TONY_ASIDES,
  INIT_REPEAT_INTENT_ASIDES,
  INIT_SESSION_TONY_ASIDES,
  INIT_SNIPPET_DEADPOOL_ASIDES,
  INIT_SNIPPET_PETER_ASIDES,
  INIT_SNIPPET_THOR_ASIDES,
  INIT_SNIPPET_WOLVERINE_ASIDES,
  INIT_STRANGE_TOKEN_ASIDES,
  INIT_WELCOME_ASIDES,
  PROMPT_MISSING_CREDENTIAL_TEMPLATES,
  formatAsideTemplate,
  ENV_RECOVERY_HINT_PLAIN,
  pickAside,
} from "../utility/aside-pools";
import { loadCliEnvFiles } from "../utility/cli-load-env";
import { getCommandAttemptCount } from "../utility/cli-personality-state";
import { maybePrintGenericSpice, printAside, printAsideMaybe } from "../utility/cli-tone";
import { buildProjAuthUrl, resolveApiBaseUrl } from "../../utils/backend-origin";
import {
  ENV_NEXT_PUBLIC_PROJECT_TOKEN,
  ENV_PROJECT_SESSION,
  ENV_PROJECT_TOKEN,
  ENV_USER_SECRET,
  ENV_VITE_PROJECT_TOKEN,
  formatDotenvLine,
  getResolvedProjectToken,
  getResolvedSession,
  getResolvedUserSecret,
} from "../../utils/env-config";
import { parseErrorBody } from "../../utils/http-utils";
import { buildStyleEntriesFromProjAuth } from "../utility/log-styles";
import type { ProjAuthConfigPayload } from "../utility/log-styles";

interface ProjAuthResponse {
  project_id?: string | null;
  project_name?: string | null;
  session?: string | null;
  styles?: unknown;
}

function printMissingCredentialHint(envKey: string): void {
  console.log("");
  const t = pickAside(PROMPT_MISSING_CREDENTIAL_TEMPLATES);
  printAside(t.emoji, formatAsideTemplate(t.line, { envKey }));
}

async function promptForProjectToken(): Promise<string> {
  printMissingCredentialHint(ENV_PROJECT_TOKEN);
  const cli = readline.createInterface({ input: stdin, output: stdout });

  try {
    const enteredProjectToken = await cli.question(
      chalk.cyan("🔐 ") + `Paste ${ENV_PROJECT_TOKEN} (your project token): `,
    );
    const projectToken = enteredProjectToken.trim();
    if (!projectToken) {
      throw new Error(`Project token cannot be empty. ${ENV_RECOVERY_HINT_PLAIN}`);
    }
    return projectToken;
  } finally {
    cli.close();
  }
}

async function promptForUserSecret(): Promise<string> {
  printMissingCredentialHint(ENV_USER_SECRET);
  const cli = readline.createInterface({ input: stdin, output: stdout });

  try {
    const enteredUserSecret = await cli.question(
      chalk.cyan("🙍 ") + `Paste ${ENV_USER_SECRET} (your user secret): `,
    );
    const userSecret = enteredUserSecret.trim();
    if (!userSecret) {
      throw new Error(`User secret cannot be empty. ${ENV_RECOVERY_HINT_PLAIN}`);
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
  return {
    project_token: projectToken,
    project_id: authResponse.project_id ?? null,
    project_name: authResponse.project_name ?? null,
    session: authResponse.session ?? null,
    styles: buildStyleEntriesFromProjAuth(authResponse.styles),
  };
}

export async function fetchProjAuthConfig(projectToken: string): Promise<InitConfigPayload> {
  const baseUrl = resolveApiBaseUrl();

  const response = await fetch(buildProjAuthUrl(baseUrl, projectToken), {
    method: "POST",
  }).catch((error: unknown) => {
    const msg = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Can't reach Auralogger right now — check your network or VPN, then try again. (${msg}) ${ENV_RECOVERY_HINT_PLAIN}`,
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
      `The reply didn’t look right. Double-check ${ENV_PROJECT_TOKEN} or run npx auralogger init.`,
    );
  }

  return buildConfigPayload(authResponse, projectToken);
}

/**
 * Same credential model as `AuraServer.syncFromSecret`: only the project token
 * must be available locally; id + session come from `POST /api/{project_token}/proj_auth`.
 */
export async function resolveProjectContextForCliChecks(): Promise<{
  projectToken: string;
  userSecret: string;
  projectId: string;
  projectName: string;
  session: string;
}> {
  const projectToken = await resolveProjectTokenForInit();
  const userSecret = await resolveUserSecretForInit();
  const payload = await fetchProjAuthConfig(projectToken);
  const projectId = payload.project_id?.trim() ?? "";
  const projectName = payload.project_name?.trim() ?? "";
  const session = payload.session?.trim() ?? "";
  if (!projectId || !session) {
    throw new Error(
      `${ENV_PROJECT_TOKEN} looks off, or the API didn’t return project id + session — ${ENV_RECOVERY_HINT_PLAIN}`,
    );
  }
  return { projectToken, userSecret, projectId, projectName, session };
}

function isPlainAuthResponse(value: unknown): value is ProjAuthResponse {
  return value !== null && typeof value === "object";
}

/** Reminder: onlylocal avoids remote log traffic — especially relevant on deploys. */
function printOnlylocalProductionDialog(): void {
  const plainBody = [
    "Deploying? Set onlylocal in configure for console-only logs.",
    "No remote sends — no per-log network cost or delay.",
  ];
  console.log("");
  for (const line of plainBody) {
    console.log("  " + chalk.white(line));
  }
  console.log("");
}

function buildAuraClientWrapperSnippet(): string {
  return [
    `import { AuraClient } from 'auralogger-cli/client'`,
    ``,
    ``,
    `let configured = false`,
    ``,
    `function ensureConfigured(): void {`,
    `  if (configured) return`,
    ``,
    `  // AuraClient.configure() only needs the project token — never put the user secret in client bundles.`,
    `  // You can also use hardcoded strings instead of env lookups below (avoid committing real values).`,
    `  // onlylocal (optional 2nd arg): true => console-only; skips per-log remote work (prod log volume = more traffic).`,
    `  // Set before production deploys when local output is enough — production generates far more log lines than dev.`,
    `  const projectToken = process.env.NEXT_PUBLIC_AURALOGGER_PROJECT_TOKEN`,
    `  if (!projectToken) {`,
    `    throw new Error('Missing NEXT_PUBLIC_AURALOGGER_PROJECT_TOKEN')`,
    `  }`,
    ``,
    `  AuraClient.configure(projectToken)`,
    `  // AuraClient.configure(projectToken, true)`,
    `  configured = true`,
    `}`,
    ``,
    `/** Browser-safe: project token only. Never include user secret in client bundles. */`,
    `export function Auralog(type: string, message: string, location?: string, data?: unknown): void {`,
    `  ensureConfigured()`,
    `  AuraClient.log(type, message, location, data)`,
    `}`,
  ].join("\n");
}

function buildAuraServerWrapperSnippet(): string {
  return [
    `import { AuraServer } from 'auralogger-cli/server'`,
    ``,
    `let configured = false`,
    ``,
    `function ensureConfigured(): void {`,
    `  if (configured) return`,
    ``,
    `  // You can also pass string literals to AuraServer.configure(...) instead of process.env (never commit real secrets).`,
    `  // onlylocal (optional 3rd arg): true => console-only; skips remote send path (prod = higher log traffic).`,
    `  // Use before production when console-only is enough; omit or false when you need remote ingest.`,
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
    `  // AuraServer.configure(projectToken, userSecret, true)`,
    `  configured = true`,
    `}`,
    ``,
    `/** Server-only: uses project token + user secret from env. Do not import from client components. */`,
    `export function AuraLog(type: string, message: string, location?: string, data?: unknown): void {`,
    `  ensureConfigured()`,
    `  AuraServer.log(type, message, location, data)`,
    `}`,
  ].join("\n");
}

function buildAuraClientUsageSnippet(): string {
  return [
    `import { Auralog } from '@/lib/auralog/client-auralog'`,
    ``,
    `Auralog('info', 'Client page mounted', 'src/app/test/page.tsx', { source: 'test-page-client' })`,
    `// expected: [info] Client page mounted @ src/app/test/page.tsx { source: 'test-page-client' }`,
    ``,
    `Auralog('warn', 'Client cache miss')`,
    `// expected: [warn] Client cache miss`,
    ``,
    `Auralog('error', 'Client fetch failed', undefined, { retrying: true })`,
    `// expected: [error] Client fetch failed { retrying: true }`,
  ].join("\n");
}

function buildAuraServerUsageSnippet(): string {
  return [
    `import { AuraLog } from '@/lib/auralog/server-auralog'`,
    ``,
    `AuraLog('info', 'Request completed', 'src/app/api/orders/route.ts', { order_id: 'ord_123', status: 201 })`,
    `// expected: [info] Request completed @ src/app/api/orders/route.ts { order_id: 'ord_123', status: 201 }`,
    ``,
    `AuraLog('warn', 'Cache miss')`,
    `// expected: [warn] Cache miss`,
    ``,
    `AuraLog('error', 'Payment gateway timeout', undefined, { provider: 'stripe' })`,
    `// expected: [error] Payment gateway timeout { provider: 'stripe' }`,
  ].join("\n");
}

function printTwoAuralogExplainer(): void {
  console.log("");
  console.log(
    chalk.bold.hex("#d2a8ff")("  🧭 ") +
      chalk.white("Split the stack: ") +
      chalk.bold.white("Auralog") +
      chalk.white(" (browser) vs ") +
      chalk.bold.white("AuraLog") +
      chalk.white(" (server) — ") +
      chalk.bold.white("two files") +
      chalk.dim(", zero crossover episodes."),
  );
  console.log(
    chalk.gray("     ") +
      chalk.hex("#ffa657")("🎨 ") +
      chalk.bold.white("Browser / frontend") +
      chalk.gray(" — React, Vue, Next client, whatever ships to users. Want ") +
      chalk.white("pretty DevTools logs") +
      chalk.gray("? This side. ") +
      chalk.dim("Project token only — never the user secret."),
  );
  console.log(
    chalk.gray("     ") +
      chalk.hex("#79c0ff")("🧱 ") +
      chalk.bold.white("Server / backend / CLI") +
      chalk.gray(" — APIs, workers, scripts, anything that never touches a phone screen. ") +
      chalk.white("User secret only lives here."),
  );
  console.log("");
}

/** Client + server snippets with the loud personality pass (init + already-configured paths). */
function printInitHelperSnippetsWithCharacterVoices(): void {
  {
    const a = pickAside(INIT_SNIPPET_PETER_ASIDES);
    printAside(a.emoji, a.line);
  }
  printCodeStory(
    "Client-side Auralog — auralogger-cli/client",
    buildAuraClientWrapperSnippet(),
  );
  printCodeStory(
    "Using your generated Auralog helper (client example logs)",
    buildAuraClientUsageSnippet(),
  );
  {
    const a = pickAside(INIT_SNIPPET_DEADPOOL_ASIDES);
    printAside(a.emoji, a.line);
  }
  {
    const a = pickAside(INIT_SNIPPET_WOLVERINE_ASIDES);
    printAside(a.emoji, a.line);
  }
  {
    const a = pickAside(INIT_SNIPPET_THOR_ASIDES);
    printAside(a.emoji, a.line);
  }
  printCodeStory(
    "Server-side AuraLog — auralogger-cli/server",
    buildAuraServerWrapperSnippet(),
  );
  printCodeStory(
    "Using your generated AuraLog helper (server example logs)",
    buildAuraServerUsageSnippet(),
  );
}

function styleInitCodeLine(line: string): string {
  if (line.startsWith("import ")) {
    return chalk.hex("#ff7b72")("import") + chalk.hex("#7ee787")(" " + line.slice(7));
  }
  if (line.startsWith("export type ")) {
    return (
      chalk.hex("#ff7b72")("export type") +
      chalk.hex("#7ee787")(line.slice("export type".length))
    );
  }
  if (line.startsWith("export function ")) {
    return (
      chalk.hex("#ff7b72")("export function") +
      chalk.hex("#7ee787")(line.slice("export function".length))
    );
  }
  return chalk.hex("#7ee787")(line);
}

function printCodeStory(title: string, snippet: string): void {
  const rawLines = snippet.split("\n");

  console.log(chalk.bold.hex("#d2a8ff")("  📋 ") + chalk.bold.white(title));
  console.log("");
  for (const line of rawLines) {
    console.log("  " + styleInitCodeLine(line));
  }
  console.log("");
}

function printCopyPasteEnvBlock(
  payload: InitConfigPayload,
  projectTokenWasAlreadyInEnv: boolean,
  userSecretWasAlreadyInEnv: boolean,
  sessionWasAlreadyInEnv: boolean,
  userSecret: string,
): void {
  const session = payload.session?.trim() ?? "";

  console.log("");
  console.log(
    chalk.bold.hex("#79c0ff")("📋 ") + chalk.bold.white("Copy-paste env block"),
  );
  console.log(
    chalk.dim(
      "   Up to five lines when everything’s new: server token, user secret, session, then the same token for Next and Vite.",
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
  if (!sessionWasAlreadyInEnv && session) {
    lines.push(formatDotenvLine(ENV_PROJECT_SESSION, session));
  }
  if (!projectTokenWasAlreadyInEnv) {
    lines.push(formatDotenvLine(ENV_NEXT_PUBLIC_PROJECT_TOKEN, payload.project_token));
    lines.push(formatDotenvLine(ENV_VITE_PROJECT_TOKEN, payload.project_token));
  }

  if (lines.length > 0) {
    for (const line of lines) {
      console.log("  " + chalk.hex("#8b949e")(line));
    }
  }

  if (projectTokenWasAlreadyInEnv) {
    console.log("");
    console.log(
      chalk.dim(
        `   Token already in env — if your client can’t read it, add ${ENV_NEXT_PUBLIC_PROJECT_TOKEN} and ${ENV_VITE_PROJECT_TOKEN} with the same ciphertext.`,
      ),
    );
  }

  if (projectTokenWasAlreadyInEnv || userSecretWasAlreadyInEnv || sessionWasAlreadyInEnv) {
    console.log("");
    if (projectTokenWasAlreadyInEnv) {
      console.log(
        chalk.dim("   ") +
          chalk.white("Project token") +
          chalk.dim(" was already set — server/Next/Vite token lines omitted above."),
      );
    }
    if (userSecretWasAlreadyInEnv) {
      console.log(
        chalk.dim("   ") +
          chalk.white(ENV_USER_SECRET) +
          chalk.dim(" was already set — omitted above."),
      );
    }
    if (sessionWasAlreadyInEnv) {
      console.log(
        chalk.dim("   ") +
          chalk.white(ENV_PROJECT_SESSION) +
          chalk.dim(" was already set — omitted above."),
      );
    }
  }
  console.log("");
}

function printInitWelcomeBanner(): void {
  console.log("");
  console.log(
    chalk.bold.white("Auralogger init") +
      chalk.dim(" — client pretty-logs + server secrets, coming right up."),
  );
  {
    const a = pickAside(INIT_WELCOME_ASIDES);
    printAside(a.emoji, a.line);
  }
  console.log("");
}

function printPostInitSummary(
  payload: InitConfigPayload,
  projectTokenWasAlreadyInEnv: boolean,
  userSecretWasAlreadyInEnv: boolean,
  sessionWasAlreadyInEnv: boolean,
  userSecret: string,
): void {
  console.log("");
  {
    const a = pickAside(INIT_SESSION_TONY_ASIDES);
    printAside(a.emoji, a.line);
  }

  printCopyPasteEnvBlock(
    payload,
    projectTokenWasAlreadyInEnv,
    userSecretWasAlreadyInEnv,
    sessionWasAlreadyInEnv,
    userSecret,
  );

  printOnlylocalProductionDialog();
  printTwoAuralogExplainer();
  printInitHelperSnippetsWithCharacterVoices();

  console.log(
    chalk.bold.hex("#f85149")("🙅 ") +
      chalk.white("Never put ") +
      chalk.bold.white(ENV_USER_SECRET) +
      chalk.white(" in frontend bundles — only the ") +
      chalk.bold.white("server") +
      chalk.white(" AuraLog file gets that."),
  );
  console.log(
    chalk.gray("   The ") +
      chalk.bold.gray("client") +
      chalk.gray(" Auralog file reads only the publishable project token from env."),
  );
  console.log("");
}

function printAlreadyConfiguredSuccess(): void {
  console.log("");
  console.log(
    chalk.bold.hex("#ffa657")("🎉 ") +
      chalk.white("Plot twist — this shell already has token, user secret, and session."),
  );
  {
    const a = pickAside(INIT_ALREADY_STRANGE_ASIDES);
    printAside(a.emoji, a.line);
  }
  console.log("");
  printTwoAuralogExplainer();
  printInitHelperSnippetsWithCharacterVoices();
  {
    const a = pickAside(INIT_ALREADY_LOKI_ASIDES);
    printAside(a.emoji, a.line);
  }
  {
    const a = pickAside(INIT_ALREADY_STEVE_ASIDES);
    printAside(a.emoji, a.line);
  }
  printOnlylocalProductionDialog();
}

export async function runInit(): Promise<void> {
  loadCliEnvFiles();

  if (getCommandAttemptCount("init") >= 2) {
    const a = pickAside(INIT_REPEAT_INTENT_ASIDES);
    printAsideMaybe(a.emoji, a.line, 0.12);
  }

  const hasProjectToken = Boolean(getResolvedProjectToken());
  const projectTokenWasAlreadyInEnv = hasProjectToken;
  const hasUserSecret = Boolean(getResolvedUserSecret());
  const userSecretWasAlreadyInEnv = hasUserSecret;
  const hasSession = Boolean(getResolvedSession());
  const sessionWasAlreadyInEnv = hasSession;

  if (hasProjectToken && hasUserSecret && hasSession) {
    printAlreadyConfiguredSuccess();
    maybePrintGenericSpice();
    return;
  }

  printInitWelcomeBanner();

  if (hasProjectToken && !hasSession) {
    console.log(
      chalk.dim("🔎 ") +
        chalk.white("Spotted a project token in env — grabbing the rest from home base…"),
    );
    {
      const a = pickAside(INIT_STRANGE_TOKEN_ASIDES);
      printAside(a.emoji, a.line);
    }
  }

  const projectToken = await resolveProjectTokenForInit();
  const userSecret = await resolveUserSecretForInit();
  const payload = await fetchProjAuthConfig(projectToken);
  printPostInitSummary(
    payload,
    projectTokenWasAlreadyInEnv,
    userSecretWasAlreadyInEnv,
    sessionWasAlreadyInEnv,
    userSecret,
  );
  console.log(
    chalk.hex("#ffa657")("🎬 ") +
      chalk.dim("Curtain call: ") +
      chalk.hex("#79c0ff")("auralogger server-check") +
      chalk.dim(" when the server pipe should flex too."),
  );
  {
    const a = pickAside(INIT_CURTAIN_TONY_ASIDES);
    printAside(a.emoji, a.line);
  }
  console.log("");
  maybePrintGenericSpice();
}
