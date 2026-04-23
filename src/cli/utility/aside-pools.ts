/**
 * CLI aside pools — each array is one "slot"; `pickAside()` chooses a random line.
 *
 * Registry (add options by extending the matching array):
 *
 * | Pool id (export)              | Where it fires                          |
 * |-------------------------------|-----------------------------------------|
 * | BIN_USAGE_ASIDES              | bin: printUsage footer                  |
 * | BIN_USAGE_RARE_MULTI_ASIDES   | bin: ~8% spike on usage                 |
 * | BIN_UNKNOWN_COMMAND_TEMPLATES | bin: invalid command ({{cmd}})          |
 * | BIN_USAGE_LEGENDARY_ASIDES    | tiered usage footer (~2%)               |
 * | pickAdaptiveFatalAside()      | bin: main() catch (escalation + error kind) |
 * | BIN_FATAL_* (legacy pools)      | optional / tests; adaptive path preferred   |
 * | INIT_WELCOME_ASIDES           | init: banner after title                |
 * | INIT_SESSION_TONY_ASIDES      | init: after env block + session OK       |
 * | GENERIC_SPICE_DEADPOOL_ASIDES | optional post-success (~20% via cli-tone)|
 * | WOLVERINE_NUDGE_ASIDES        | repeated mistakes (bin catch)            |
 * | INIT_STRANGE_TOKEN_ASIDES     | init: token in env, no session          |
 * | PROMPT_MISSING_CREDENTIAL_TEMPLATES | init: before paste when env key missing ({{envKey}}) |
 * | ENV_RECOVERY_HINT_PLAIN       | factual suffix for Error.message only   |
 * | ENV_SETUP_RECOVERY_ASIDES     | asides: .env / init flavor (not in errors) |
 * | INIT_REPEAT_INTENT_ASIDES     | init: 2nd+ run in session               |
 * | GET_LOGS_SKIPPED_SETUP_INTENT | get-logs: no token + never completed init |
 * | INIT_CURTAIN_TONY_ASIDES      | init: end, after server-check hint      |
 * | INIT_ALREADY_STRANGE_ASIDES   | init: already-configured header aside   |
 * | INIT_ALREADY_LOKI_ASIDES      | init: already-configured session reset  |
 * | INIT_ALREADY_STEVE_ASIDES     | init: already-configured server-check   |
 * | INIT_SNIPPET_PETER_ASIDES     | init: before client code story          |
 * | INIT_SNIPPET_DEADPOOL_ASIDES  | init: after client snippet              |
 * | INIT_SNIPPET_WOLVERINE_ASIDES | init: after Deadpool                    |
 * | INIT_SNIPPET_THOR_ASIDES      | init: before server snippet (~50% Thor vs Tony) |
 * | GET_LOGS_EMPTY_ASIDES         | get-logs: zero rows                      |
 * | GET_LOGS_SUCCESS_TEMPLATES    | get-logs: success ({{n}})                |
 * | GET_LOGS_STYLES_ASIDES        | get-logs: fetched styles this run       |
 * | GET_LOGS_OPEN_ASIDES          | get-logs: command start                 |
 * | GET_LOGS_DEADPOOL_SCROLL_ASIDES | get-logs: ~35% after borrowed styles |
 * | SERVER_CHECK_OPEN_ASIDES      | server-check: before connect            |
 * | SERVER_CHECK_SUCCESS_THOR_ASIDES | server-check: after OK (~50% Thor vs Tony) |
 * | SERVER_CHECK_FAIL_WOLVERINE_ASIDES | server-check: timeout / ws error   |
 * | CLIENT_CHECK_START_PETER_ASIDES | client-check: before connect         |
 * | CLIENT_CHECK_SUCCESS_ASIDES   | client-check: after OK                  |
 * | TEST_SERVERLOG_START_BANNER   | test-serverlog: intro                   |
 * | TEST_SERVERLOG_SUCCESS_MAIN_ASIDES | test-serverlog: after burst (Tony/DP) |
 * | pickTestServerlogSuccessAside() | + ~5% Hulk                           |
 * | TEST_CLIENTLOG_START_ASIDES   | test-clientlog: intro                   |
 * | TEST_CLIENTLOG_SUCCESS_ASIDES | test-clientlog: after burst            |
 */

export type AsideTier = "common" | "rare" | "legendary";

/** Optional metadata for weighted / tiered picks (most entries omit these). */
export type AsideEntry = {
  readonly emoji: string;
  readonly line: string;
  readonly tier?: AsideTier;
  readonly weight?: number;
};

/** Tier buckets: ~85% common, ~13% rare, ~2% legendary (when arrays non-empty). */
export type TieredAsidePools = {
  readonly common: readonly AsideEntry[];
  readonly rare: readonly AsideEntry[];
  readonly legendary: readonly AsideEntry[];
};

/** Default chance to skip an aside entirely (lets factual output breathe). */
export const DEFAULT_SILENCE_ASIDE_CHANCE = 0.15;

/** Replace {{name}} placeholders (e.g. {{n}}, {{cmd}}). */
export function formatAsideTemplate(
  template: string,
  vars: Record<string, string | number>,
): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) =>
    String(vars[key] ?? ""),
  );
}

export function pickAside(pool: readonly AsideEntry[]): AsideEntry {
  return pool[Math.floor(Math.random() * pool.length)]!;
}

/** Optional ~20% after successes — extra Deadpool without hiding facts elsewhere. */
export const GENERIC_SPICE_DEADPOOL_ASIDES: readonly AsideEntry[] = [
  { emoji: "💀", line: "Deadpool: Not your best work. We move." },
  { emoji: "💀", line: "Deadpool: I've seen worse. Not today though." },
  { emoji: "💀", line: "Deadpool: You're learning. Slowly. Painfully." },
];

/** Micro-lines after repeated mistakes (pair with fatal / correction paths). */
export const WOLVERINE_NUDGE_ASIDES: readonly AsideEntry[] = [
  { emoji: "🐺", line: "Wolverine: Focus." },
  { emoji: "🐺", line: "Wolverine: Read properly." },
  { emoji: "🐺", line: "Wolverine: Again. Carefully." },
];

/** Occasionally inject a rare multi-line “gold” aside (~8% default). */
export function pickAsideWithRareSpike(
  mainPool: readonly AsideEntry[],
  rarePool: readonly AsideEntry[],
  rareChance: number,
): AsideEntry {
  if (rarePool.length > 0 && Math.random() < rareChance) {
    return pickAside(rarePool);
  }
  return pickAside(mainPool);
}

/** ~85% common, ~13% rare, ~2% legendary. */
export function pickTieredAside(pools: TieredAsidePools): AsideEntry {
  const r = Math.random();
  if (pools.legendary.length > 0 && r < 0.02) {
    return pickAside(pools.legendary);
  }
  if (pools.rare.length > 0 && r < 0.15) {
    return pickAside(pools.rare);
  }
  if (pools.common.length > 0) {
    return pickAside(pools.common);
  }
  if (pools.rare.length > 0) {
    return pickAside(pools.rare);
  }
  return pickAside(pools.legendary);
}

export type ErrorAsideKind = "auth-env" | "network" | "logic" | "generic";

export function classifyErrorForAside(message: string): ErrorAsideKind {
  const m = message.toLowerCase();
  if (
    m.includes("network") ||
    m.includes("vpn") ||
    m.includes("wi-fi") ||
    m.includes("wi fi") ||
    m.includes("reach auralogger") ||
    m.includes("can't reach") ||
    m.includes("econnrefused") ||
    m.includes("fetch failed") ||
    m.includes("socket") ||
    m.includes("timed out") ||
    m.includes("timeout") ||
    m.includes("connection") ||
    m.includes("tunnel") ||
    m.includes("dns")
  ) {
    return "network";
  }
  if (
    m.includes("token") ||
    m.includes("secret") ||
    m.includes("auth") ||
    m.includes("401") ||
    m.includes("403") ||
    m.includes(".env") ||
    m.includes("credential") ||
    m.includes("unauthorized") ||
    m.includes("forbidden") ||
    m.includes("auralogger_project") ||
    m.includes("user_secret")
  ) {
    return "auth-env";
  }
  if (
    m.includes("json") ||
    m.includes("parse") ||
    m.includes("invalid") ||
    m.includes("filter") ||
    m.includes("expected") ||
    m.includes("unknown filter") ||
    m.includes("garbled")
  ) {
    return "logic";
  }
  return "generic";
}

// --- fatal aside escalation (bin main catch) ---

export const FATAL_FIRST_FAIL_GENERIC_TONY_ASIDES: readonly AsideEntry[] = [
  {
    emoji: "🦾",
    line: "Tony: That's not valid — fix the command or the input, then rerun.",
  },
  { emoji: "🦾", line: "Tony: Red line's the truth. Adjust, rerun, we're good." },
];

export const FATAL_FIRST_FAIL_AUTH_ASIDES: readonly AsideEntry[] = [
  {
    emoji: "🦾",
    line:
      "Tony: Auth blew up — token, user secret, or .env in the wrong place. Pick one, fix it, rerun. Not a personality test.",
  },
  {
    emoji: "💀",
    line:
      "Deadpool: Server looked at your creds and went 'nope.' Sync .env with reality — or run init like a grown-up.",
  },
  {
    emoji: "🐺",
    line:
      "Wolverine: 401/403 isn't moody — it's wrong secret or wrong token. Fix .env, same cwd you run commands from.",
  },
];

export const FATAL_FIRST_FAIL_NETWORK_ASIDES: readonly AsideEntry[] = [
  {
    emoji: "🐺",
    line:
      "Wolverine: Fetch died — Wi‑Fi, VPN, firewall, or you're not even in the project folder. Hunt in that order.",
  },
  {
    emoji: "🦾",
    line:
      "Tony: Relax — can't reach the API. Toggle VPN, check proxy, confirm you're online. Then we talk .env.",
  },
  {
    emoji: "💀",
    line:
      "Deadpool: The internet ghosted you. Or Auralogger did. Either way — network first, blame the code second.",
  },
  {
    emoji: "🧪",
    line:
      "Banner: Connection failed — rule out network, then AURALOGGER_WS_URL / API URL overrides. Science, not vibes.",
  },
];

export const FATAL_FIRST_FAIL_LOGIC_ASIDES: readonly AsideEntry[] = [
  { emoji: "🧪", line: "Banner: Logic/input — read the line above, then fix the shape." },
  { emoji: "💀", line: "Deadpool: Cool, it broke. Fix filters/JSON, rerun." },
];

export const FATAL_ESCALATION_WOLVERINE_ASIDES: readonly AsideEntry[] = [
  { emoji: "🐺", line: "Wolverine: Same mistake. Slow down." },
  { emoji: "🐺", line: "Wolverine: Again? Read twice, type once." },
];

export const FATAL_ESCALATION_DEADPOOL_ASIDES: readonly AsideEntry[] = [
  { emoji: "💀", line: "Deadpool: Oh wow we're doing this again." },
  { emoji: "💀", line: "Deadpool: Déjà vu, but worse." },
];

export const FATAL_ESCALATION_HULK_ASIDES: readonly AsideEntry[] = [
  { emoji: "💚", line: "Hulk: STOP BREAKING." },
  { emoji: "💚", line: "Hulk: USER. FIX. COMMAND." },
];

export const FATAL_MULTI_CHAIN_ASIDES: readonly AsideEntry[] = [
  {
    emoji: "💀",
    line:
      "Deadpool: Still nothing.\nWolverine: Then nothing ran.\nDeadpool: Or everything died.\nWolverine: Fix it.",
  },
  {
    emoji: "💀",
    line:
      "Deadpool: He's about to rerun without fixing it.\nWolverine: Don't.\nDeadpool: He did it.\nWolverine: Of course.",
  },
  {
    emoji: "🦾",
    line:
      "Tony: It works.\nDeadpool: Suspicious.\nTony: It's correct.\nDeadpool: For now.",
  },
  {
    emoji: "💚",
    line:
      "Banner: Something's wrong.\nHulk: SMASH.\nBanner: Not yet.\nHulk: SOON.",
  },
];

/**
 * Fatal handler: consecutive failures escalate Tony → Wolverine → Deadpool → (rare) Hulk;
 * first failure also biases pool by error shape (auth/network/logic).
 */
export function pickAdaptiveFatalAside(
  consecutiveFailures: number,
  errorMessage: string,
): AsideEntry {
  if (consecutiveFailures >= 4 && Math.random() < 0.22) {
    return pickAside(FATAL_MULTI_CHAIN_ASIDES);
  }
  if (consecutiveFailures >= 5 && Math.random() < 0.48) {
    return pickAside(FATAL_ESCALATION_HULK_ASIDES);
  }
  if (consecutiveFailures >= 3) {
    return pickAside(FATAL_ESCALATION_DEADPOOL_ASIDES);
  }
  if (consecutiveFailures === 2) {
    return pickAside(FATAL_ESCALATION_WOLVERINE_ASIDES);
  }

  const kind = classifyErrorForAside(errorMessage);
  if (kind === "network") {
    return pickAside(FATAL_FIRST_FAIL_NETWORK_ASIDES);
  }
  if (kind === "auth-env") {
    return pickAside(FATAL_FIRST_FAIL_AUTH_ASIDES);
  }
  if (kind === "logic") {
    return pickAside(FATAL_FIRST_FAIL_LOGIC_ASIDES);
  }
  return pickAside(FATAL_FIRST_FAIL_GENERIC_TONY_ASIDES);
}

// --- bin/auralogger.ts ---

export const BIN_USAGE_ASIDES: readonly AsideEntry[] = [
  {
    emoji: "🕷️",
    line:
      "Peter: Pick a command, dude — init if you're setting things up, get-logs if you're hunting past mistakes, *-check if you're paranoid (valid).",
  },
  {
    emoji: "💀",
    line:
      "Deadpool: Alright, press a button. Any button. Preferably init if you have no idea what you're doing (which… statistically, you don't).",
  },
  {
    emoji: "🦾",
    line:
      "Tony: Let's not freestyle this. init sets you up, get-logs shows your mistakes, *-check tells you if things are actually working. Pick a command. Preferably the right one this time.",
  },
];

/** ~8%: multi-line gold (Tony + Deadpool). */
export const BIN_USAGE_RARE_MULTI_ASIDES: readonly AsideEntry[] = [
  {
    emoji: "🦾",
    line:
      "Tony: It works.\nDeadpool: For once.\nTony: It usually works.\nDeadpool: Sure it does.",
  },
  {
    emoji: "🦾",
    line:
      "Tony: It works.\nDeadpool: Suspicious.\nTony: It's correct.\nDeadpool: For now.",
  },
];

/** Unknown argv[0]; use {{cmd}}. */
export const BIN_UNKNOWN_COMMAND_TEMPLATES: readonly AsideEntry[] = [
  {
    emoji: "🐺",
    line: 'Wolverine: "{{cmd}}" isn\'t a command. Read the list.',
  },
  {
    emoji: "🦾",
    line: 'Tony: "{{cmd}}" — not a thing. Copy a real command from the list.',
  },
  {
    emoji: "💀",
    line: 'Deadpool: "{{cmd}}" — bold, wrong, we\'re taking notes.',
  },
];

export const BIN_USAGE_LEGENDARY_ASIDES: readonly AsideEntry[] = [
  { emoji: "💚", line: "Hulk: PICK. COMMAND." },
];

/** printUsage: rare when user has succeeded several commands this process. */
export const CLI_VETERAN_USAGE_ASIDES: readonly AsideEntry[] = [
  { emoji: "🦾", line: "Tony: Back again. Good." },
  { emoji: "💀", line: "Deadpool: Regular. Cute." },
];

export const BIN_FATAL_ERROR_ASIDES: readonly AsideEntry[] = [
  {
    emoji: "🧪",
    line: "Banner: Red line's the signal — token, env, or network. Fix, rerun.",
  },
  {
    emoji: "🧪",
    line: "Banner: Error's above. Read it twice, fix it once.",
  },
];

/** ~10%: multi-line gold (Deadpool + Wolverine / Banner + Hulk). */
export const BIN_FATAL_RARE_MULTI_ASIDES: readonly AsideEntry[] = [
  {
    emoji: "💀",
    line:
      "Deadpool: He's about to ignore the error message.\nWolverine: Don't.\nDeadpool: He's doing it.\nWolverine: Don't.",
  },
  {
    emoji: "💚",
    line:
      "Banner: Something's wrong.\nHulk: SMASH.\nBanner: Not yet.\nHulk: SOON.",
  },
];

// --- init.ts ---

export const INIT_REPEAT_INTENT_ASIDES: readonly AsideEntry[] = [
  {
    emoji: "💀",
    line: "Deadpool: Init again? Didn't trust yourself the first time?",
  },
  {
    emoji: "🦾",
    line: "Tony: Back for round two — bring the right token.",
  },
];

export const INIT_WELCOME_ASIDES: readonly AsideEntry[] = [
  {
    emoji: "🎬",
    line:
      "Tony: Welcome to setup. Answer the prompts. Yes, all of them. This isn't optional character development.",
  },
  {
    emoji: "🎬",
    line:
      "Tony: Welcome to setup. Answer the prompts. Don't skip ahead. This isn't a YouTube tutorial.",
  },
  {
    emoji: "💀",
    line:
      "Deadpool: We're about to store secrets. Not your feelings — actual secrets. Try not to leak them this time.",
  },
];

export const INIT_SESSION_TONY_ASIDES: readonly AsideEntry[] = [
  {
    emoji: "🦾",
    line:
      "Tony: Session's valid — next step's below. Relax: browser never gets the user secret. Don't get creative.",
  },
];

export const INIT_STRANGE_TOKEN_ASIDES: readonly AsideEntry[] = [
  {
    emoji: "🔮",
    line:
      "Strange: Token's in env, session isn't — one proj_auth call. Don't overthink it.",
  },
];

/** Before interactive paste: env key missing. Use {{envKey}} in templates. */
export const PROMPT_MISSING_CREDENTIAL_TEMPLATES: readonly AsideEntry[] = [
  {
    emoji: "🦾",
    line:
      "Tony: Missing {{envKey}} — paste it, save it in .env (or run init), then rerun.",
  },
  {
    emoji: "🕷️",
    line:
      "Peter: {{envKey}} ghosted us — paste it, save it, move on.",
  },
  {
    emoji: "💀",
    line:
      "Deadpool: {{envKey}} is missing — paste it into .env, or run init and let it babysit you.",
  },
  {
    emoji: "🐺",
    line:
      "Wolverine: {{envKey}} missing — fix .env (or run init), then rerun.",
  },
];

/**
 * Plain appendix for Error.message only — no character voice here (voice lives in printAside).
 * Keeps the red line scannable; bin + pools deliver the chaos.
 */
export const ENV_RECOVERY_HINT_PLAIN =
  "Tip: put creds in a .env next to where you run the CLI, or run npx auralogger init.";

/** Printed as asides when you want setup flavor (not stuffed into Error strings). */
export const ENV_SETUP_RECOVERY_ASIDES: readonly AsideEntry[] = [
  {
    emoji: "🦾",
    line:
      "Tony: .env lives where you run this — not three folders up, not your Downloads. init hands you the cheat sheet.",
  },
  {
    emoji: "🐺",
    line:
      "Wolverine: Wrong cwd, empty .env, drunk paste — one of those. Fix it, init if you're lost, move on.",
  },
  {
    emoji: "💀",
    line:
      "Deadpool: npx auralogger init is the dotenv greatest-hits album. Same repo root you actually use. You're welcome.",
  },
  {
    emoji: "💀",
    line:
      "Deadpool: If your secret's in the clipboard and not in .env, that's not 'agile' — that's chaos.",
  },
  {
    emoji: "🦾",
    line:
      "Tony: Matching tokens, real .env, cwd that makes sense. init exists because READMEs are decorative.",
  },
];

export const INIT_CURTAIN_TONY_ASIDES: readonly AsideEntry[] = [
  {
    emoji: "🎬",
    line:
      "Tony: Init's on the board. Optional boss fight: auralogger server-check — prove the wire's real.",
  },
];

export const INIT_ALREADY_STRANGE_ASIDES: readonly AsideEntry[] = [
  {
    emoji: "🔮",
    line:
      "Strange: Everything you need is already in this shell. Don't overthink it. Just execute.",
  },
];

export const INIT_ALREADY_LOKI_ASIDES: readonly AsideEntry[] = [
  {
    emoji: "🐍",
    line:
      "Loki: Need a new session? Clear it and run init again. Relax, it's a reset — not a crime scene cleanup.",
  },
];

export const INIT_ALREADY_STEVE_ASIDES: readonly AsideEntry[] = [
  {
    emoji: "🛡️",
    line:
      "Steve: When you're ready — auralogger server-check. Verify the pipe; don't just vibe.",
  },
];

export const INIT_SNIPPET_PETER_ASIDES: readonly AsideEntry[] = [
  {
    emoji: "🕷️",
    line:
      "Peter: Client helper = clean logs, zero secrets leaked. That's the win condition.",
  },
];

export const INIT_SNIPPET_DEADPOOL_ASIDES: readonly AsideEntry[] = [
  {
    emoji: "💀",
    line:
      "Deadpool: Hey. Yeah you. Thinking of putting secrets in frontend? Don't. That's not a bug, that's a career-ending origin story.",
  },
];

export const INIT_SNIPPET_WOLVERINE_ASIDES: readonly AsideEntry[] = [
  {
    emoji: "🐺",
    line: "Wolverine: Keep the secret on the server. No debate. No exceptions.",
  },
];

/** Before server AuraLog snippet — ~50% Thor vs Tony (Thor dialed back). */
export const INIT_SNIPPET_THOR_ASIDES: readonly AsideEntry[] = [
  {
    emoji: "⚡",
    line:
      "Thor: Snippet below — server only. Frontend touches user_secret? That's on you.",
  },
  {
    emoji: "🦾",
    line:
      "Tony: That's server-side only. Don't get creative — user_secret never ships to the browser.",
  },
];

// --- get-logs.ts ---

export const GET_LOGS_EMPTY_ASIDES: readonly AsideEntry[] = [
  {
    emoji: "💀",
    line:
      "Deadpool: Zero logs — nothing happened or everything broke quietly. Both annoying.",
  },
  {
    emoji: "🐺",
    line:
      "Wolverine: No logs. Either nothing ran… or nothing worked. Either way — fix it.",
  },
  {
    emoji: "🧪",
    line: "Banner: No rows — loosen filters or confirm the app actually logs.",
  },
];

/** Lines must include {{n}} for the printed log count. */
export const GET_LOGS_SUCCESS_TEMPLATES: readonly AsideEntry[] = [
  {
    emoji: "🦾",
    line:
      "Tony: {{n}} logs — there's your paper trail. Read it before you blame the network.",
  },
  {
    emoji: "💀",
    line: "Deadpool: {{n}} logs. That's a lot of evidence against you.",
  },
  {
    emoji: "🐺",
    line: "Wolverine: {{n}} logs. Stop scrolling, start fixing.",
  },
];

export const GET_LOGS_STYLES_ASIDES: readonly AsideEntry[] = [
  {
    emoji: "🦾",
    line:
      "Tony: No styles? Borrowed them for this run. Toss in .env later if you care about looks.",
  },
  {
    emoji: "💀",
    line:
      "Deadpool: We stole some colors for this run. Don't get attached.",
  },
];

/** No project token in env + user never finished init this session (in-process). */
export const GET_LOGS_SKIPPED_SETUP_INTENT_ASIDES: readonly AsideEntry[] = [
  {
    emoji: "🦾",
    line:
      "Tony: No token, no setup — and you still ran this. Bold. Fix it.",
  },
  {
    emoji: "💀",
    line:
      "Deadpool: Skipped setup and expected magic. I respect the confidence.",
  },
];

export const GET_LOGS_OPEN_ASIDES: readonly AsideEntry[] = [
  {
    emoji: "🦾",
    line:
      "Tony: Pulling logs. Credentials are handled — don't do anything creative.",
  },
  {
    emoji: "💀",
    line:
      "Deadpool: Secure request incoming. Please don't leak anything in chat this time.",
  },
];

export const GET_LOGS_DEADPOOL_SCROLL_ASIDES: readonly AsideEntry[] = [
  {
    emoji: "💀",
    line: "Deadpool: Still scrolling? That's not debugging — that's avoidance.",
  },
  {
    emoji: "💀",
    line: "Deadpool: 200 lines deep and no clue? Consistency, I'll give you that.",
  },
];

// --- server-check.ts ---

export const SERVER_CHECK_OPEN_ASIDES: readonly AsideEntry[] = [
  {
    emoji: "🦾",
    line:
      "Tony: Opening the pipe—secret stays server-side, token rides the URL, don't panic unless it stalls.",
  },
  {
    emoji: "🐺",
    line:
      "Wolverine: Opening pipe. VPN, firewall, wrong env — pick your villain if it dies.",
  },
  {
    emoji: "💀",
    line:
      "Deadpool: Server WebSocket o'clock. If it fails, it's almost never 'mysterious magic.'",
  },
];

/** After OK — ~50% Thor vs Tony (less Thor overall). */
export const SERVER_CHECK_SUCCESS_THOR_ASIDES: readonly AsideEntry[] = [
  {
    emoji: "⚡",
    line: "Thor: Log sent. Dashboard empty? Refresh.",
  },
  {
    emoji: "🦾",
    line:
      "Tony: Relax — socket's fine. Your UI just needs a refresh. Not everything's a crisis.",
  },
];

export const SERVER_CHECK_FAIL_WOLVERINE_ASIDES: readonly AsideEntry[] = [
  {
    emoji: "🐺",
    line:
      "Wolverine: If it timed out, something's blocking it. Find it. Fix it. Move on.",
  },
];

export const CHECK_RETRY_ASIDES: readonly AsideEntry[] = [
  {
    emoji: "🦾",
    line: "Tony: Glitches happen—hit retry before the speeches.",
  },
  {
    emoji: "💀",
    line: "Deadpool: Retry arc unlocked. Same plan, less panic.",
  },
  {
    emoji: "🐺",
    line: "Wolverine: Breathe. Retry. Then decide what's broken.",
  },
];

// --- client-check.ts ---

export const CLIENT_CHECK_START_PETER_ASIDES: readonly AsideEntry[] = [
  {
    emoji: "🕷️",
    line:
      "Peter: This is how browsers talk. No secret. Just the token. Simple, safe, done.",
  },
  {
    emoji: "🕷️",
    line:
      "Peter: Browser tunnel—token in the URL, no Bearer, just like a real tab.",
  },
];

export const CLIENT_CHECK_SUCCESS_ASIDES: readonly AsideEntry[] = [
  {
    emoji: "🐺",
    line:
      "Wolverine: It works here. Your app should match it. No excuses.",
  },
  {
    emoji: "💀",
    line:
      "Deadpool: This passed. Your app didn't. That's not a coincidence.",
  },
];

// --- test-logger.ts ---

export const TEST_SERVERLOG_START_BANNER_ASIDES: readonly AsideEntry[] = [
  {
    emoji: "💚",
    line:
      "Banner: Sending real logs through the production path. This is the signal, not a simulation.",
  },
  {
    emoji: "💚",
    line:
      "Banner: Same pipeline as production. If this fails, the issue is real.",
  },
];

/** Tony + Deadpool only; Hulk via pickTestServerlogSuccessAside() at ~5%. */
export const TEST_SERVERLOG_SUCCESS_MAIN_ASIDES: readonly AsideEntry[] = [
  {
    emoji: "🦾",
    line:
      "Tony: Logs landed. System's working. If something's wrong, it's upstream.",
  },
  {
    emoji: "💀",
    line:
      "Deadpool: Logs are in. If you still can't find the bug… that's a talent.",
  },
];

export const TEST_CLIENTLOG_START_ASIDES: readonly AsideEntry[] = [
  {
    emoji: "🦾",
    line:
      "Tony: Simulating a browser. Same protocol, cleaner environment. Pay attention to what changes.",
  },
  {
    emoji: "💀",
    line:
      "Deadpool: It's fake browser time. Don't worry — the bugs are still real.",
  },
];

export const TEST_CLIENTLOG_SUCCESS_ASIDES: readonly AsideEntry[] = [
  {
    emoji: "🐺",
    line: "Wolverine: It worked. Your app should too.",
  },
  {
    emoji: "💀",
    line: "Deadpool: This worked. Your app didn't. That's personal.",
  },
];

/** ~5% Hulk spike; otherwise pickTestServerlogSuccessAside uses TEST_SERVERLOG_SUCCESS_MAIN_ASIDES. */
export function pickTestServerlogSuccessAside(): AsideEntry {
  if (Math.random() < 0.05) {
    return {
      emoji: "💚",
      line: "Hulk: LOGS SMASH. WORK GOOD.",
    };
  }
  return pickAside(TEST_SERVERLOG_SUCCESS_MAIN_ASIDES);
}
