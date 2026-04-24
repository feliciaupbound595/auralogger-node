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
  name?: string | null;
  // Back-compat: older API shape used project_name.
  project_name?: string | null;
  role?: string | null;
  iv?: string | null;
  user_name?: string | null;
  owner_key?: string | null;
  plan?: string | null;
  session?: string | null;
  styles?: unknown;
  // PostgREST may return boolean true or the string 'true'.
  encrypted?: boolean | string | null;
  // Back-compat: some deployments/store layers misspelled this as `encryption`.
  encryption?: boolean | null;
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
  encrypted: boolean;
}

function buildConfigPayload(
  authResponse: ProjAuthResponse,
  projectToken: string,
): InitConfigPayload {
  const rawEncrypted = authResponse.encrypted ?? authResponse.encryption ?? true;
  const encrypted = rawEncrypted === true || rawEncrypted === "true";
  return {
    project_token: projectToken,
    project_id: authResponse.project_id ?? null,
    project_name: authResponse.name ?? authResponse.project_name ?? null,
    session: authResponse.session ?? null,
    styles: buildStyleEntriesFromProjAuth(authResponse.styles),
    encrypted,
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

function buildAuraClientWrapperSnippet(): string {
  return [
    `import { AuraClient } from 'auralogger-cli'`,
    ``,
    ``,
    `let configured = false`,
    ``,
    `function ensureConfigured(): void {`,
    `  if (configured) return`,
    ``,
    `  // AuraClient.configure() only needs the project token — never put the user secret in client bundles.`,
    `  // You can also use hardcoded strings instead of env lookups below (avoid committing real values).`,
    `  const projectToken = process.env.NEXT_PUBLIC_AURALOGGER_PROJECT_TOKEN || process.env.VITE_AURALOGGER_PROJECT_TOKEN || process.env.AURALOGGER_PROJECT_TOKEN`,
    `  if (projectToken) {`,
    `    AuraClient.configure(projectToken)`,
    `  } else {`,
    `    console.warn('[Auralogger] Missing project token env; local-only logging enabled.')`,
    `    AuraClient.configure('')`,
    `  }`,
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

function buildAuraServerWrapperSnippet(encrypted: boolean): string {
  const serverConfigureBlock = encrypted
    ? [
        `  // You can also pass string literals to AuraServer.configure(...) instead of process.env (never commit real secrets).`,
        `  const projectToken = process.env.NEXT_PUBLIC_AURALOGGER_PROJECT_TOKEN || process.env.VITE_AURALOGGER_PROJECT_TOKEN || process.env.AURALOGGER_PROJECT_TOKEN`,
        `  const userSecret = process.env.${ENV_USER_SECRET} || ''`,
        `  if (projectToken && userSecret) {`,
        `    AuraServer.configure(projectToken, userSecret)`,
        `  } else {`,
        `    console.warn('[Auralogger] Missing server credentials env; local-only logging enabled.')`,
        `    AuraServer.configure(projectToken || '', userSecret)`,
        `  }`,
      ]
    : [
        `  // Non-encrypted flow: AuraServer.configure(projectToken) uses create_browser_logs with no user secret.`,
        `  const projectToken = process.env.NEXT_PUBLIC_AURALOGGER_PROJECT_TOKEN || process.env.VITE_AURALOGGER_PROJECT_TOKEN || process.env.AURALOGGER_PROJECT_TOKEN`,
        `  if (projectToken) {`,
        `    AuraServer.configure(projectToken)`,
        `  } else {`,
        `    console.warn('[Auralogger] Missing project token env; local-only logging enabled.')`,
        `    AuraServer.configure('')`,
        `  }`,
      ];

  const serverDoc = encrypted
    ? `/** Server-only: uses project token + user secret from env. Do not import from client components. */`
    : `/** Server-only: uses project token only (non-encrypted flow). Do not import from client components. */`;

  return [
    `import { AuraServer } from 'auralogger-cli'`,
    ``,
    `let configured = false`,
    ``,
    `function ensureConfigured(): void {`,
    `  if (configured) return`,
    ``,
    ...serverConfigureBlock,
    `  // AuraServer.configure(); // console-only logs to avoid network overhead and costs (use in production).`,
    `  configured = true`,
    `}`,
    ``,
    serverDoc,
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

function printTwoAuralogExplainer(encrypted: boolean): void {
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
      (encrypted
        ? chalk.white("User secret only lives here.")
        : chalk.white("No user secret needed in non-encrypted mode.")),
  );
  console.log("");
}

/** Client + server snippets with the loud personality pass (init + already-configured paths). */
function printInitHelperSnippetsWithCharacterVoices(encrypted: boolean): void {
  {
    const a = pickAside(INIT_SNIPPET_PETER_ASIDES);
    printAside(a.emoji, a.line);
  }
  printCodeStory(
    "Client-side Auralog — auralogger-cli (AuraClient)",
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
    "Server-side AuraLog — auralogger-cli (AuraServer)",
    buildAuraServerWrapperSnippet(encrypted),
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
  const encrypted = payload.encrypted;

  console.log("");
  console.log(
    chalk.bold.hex("#79c0ff")("📋 ") + chalk.bold.white("Copy-paste env block"),
  );
  if (encrypted) {
    console.log(
      chalk.dim(
        "   Up to five lines when everything’s new: server token, user secret, session, then the same token for Next and Vite.",
      ),
    );
  } else {
    console.log(
      chalk.dim(
        "   No encryption — just your project token and session needed.",
      ),
    );
  }
  console.log("");

  const lines: string[] = [];
  if (!projectTokenWasAlreadyInEnv) {
    lines.push(formatDotenvLine(ENV_PROJECT_TOKEN, payload.project_token));
  }
  if (encrypted && !userSecretWasAlreadyInEnv && userSecret) {
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
        `   Token already in env — if your client can’t read it, add ${ENV_NEXT_PUBLIC_PROJECT_TOKEN} and ${ENV_VITE_PROJECT_TOKEN} with the same value.`,
      ),
    );
  }

  if (projectTokenWasAlreadyInEnv || (encrypted && userSecretWasAlreadyInEnv) || sessionWasAlreadyInEnv) {
    console.log("");
    if (projectTokenWasAlreadyInEnv) {
      console.log(
        chalk.dim("   ") +
          chalk.white("Project token") +
          chalk.dim(" was already set — token lines omitted above."),
      );
    }
    if (encrypted && userSecretWasAlreadyInEnv) {
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

  if (payload.encrypted) {
    printTwoAuralogExplainer(true);
    printInitHelperSnippetsWithCharacterVoices(true);
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
  } else {
    printTwoAuralogExplainer(false);
    printInitHelperSnippetsWithCharacterVoices(false);
  }
  console.log("");
}

function printAlreadyConfiguredSuccess(encrypted: boolean): void {
  console.log("");
  if (encrypted) {
    console.log(
      chalk.bold.hex("#ffa657")("🎉 ") +
        chalk.white("Plot twist — this shell already has token, user secret, and session."),
    );
  } else {
    console.log(
      chalk.bold.hex("#ffa657")("🎉 ") +
        chalk.white("Already set — this shell has token and session. No encryption, no secret needed."),
    );
  }
  {
    const a = pickAside(INIT_ALREADY_STRANGE_ASIDES);
    printAside(a.emoji, a.line);
  }
  console.log("");
  if (encrypted) {
    printTwoAuralogExplainer(true);
    printInitHelperSnippetsWithCharacterVoices(true);
  } else {
    printTwoAuralogExplainer(false);
    printInitHelperSnippetsWithCharacterVoices(false);
  }
  {
    const a = pickAside(INIT_ALREADY_LOKI_ASIDES);
    printAside(a.emoji, a.line);
  }
  {
    const a = pickAside(INIT_ALREADY_STEVE_ASIDES);
    printAside(a.emoji, a.line);
  }
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
  const payload = await fetchProjAuthConfig(projectToken);
  const encrypted = payload.encrypted;

  // For non-encrypted projects, token + session is sufficient — no secret needed.
  if (!encrypted && hasProjectToken && hasSession) {
    printAlreadyConfiguredSuccess(false);
    maybePrintGenericSpice();
    return;
  }

  // For encrypted projects, all three must be present to skip setup.
  if (encrypted && hasProjectToken && hasUserSecret && hasSession) {
    printAlreadyConfiguredSuccess(true);
    maybePrintGenericSpice();
    return;
  }

  let userSecret = "";
  if (encrypted) {
    userSecret = await resolveUserSecretForInit();
  }

  printPostInitSummary(
    payload,
    projectTokenWasAlreadyInEnv,
    userSecretWasAlreadyInEnv,
    sessionWasAlreadyInEnv,
    userSecret,
  );
  if (encrypted) {
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
  }
  console.log("");
  maybePrintGenericSpice();
}
