#!/usr/bin/env node

import "./quiet-dotenv-first";

import chalk from "chalk";

import {
  BIN_UNKNOWN_COMMAND_TEMPLATES,
  BIN_USAGE_ASIDES,
  BIN_USAGE_LEGENDARY_ASIDES,
  BIN_USAGE_RARE_MULTI_ASIDES,
  CLI_VETERAN_USAGE_ASIDES,
  DEFAULT_SILENCE_ASIDE_CHANCE,
  ENV_SETUP_RECOVERY_ASIDES,
  classifyErrorForAside,
  formatAsideTemplate,
  pickAdaptiveFatalAside,
  pickAside,
  pickTieredAside,
  WOLVERINE_NUDGE_ASIDES,
} from "../utility/aside-pools";
import { loadCliEnvFiles } from "../utility/cli-load-env";
import {
  getConsecutiveFailures,
  getTotalSuccessfulCommands,
  noteCommandDispatch,
  recordCliFailure,
  recordCliSuccess,
} from "../utility/cli-personality-state";
import { maybePrintGenericSpice, printAside, printAsideMaybe } from "../utility/cli-tone";
import { runTestClientlog } from "../services/test-logger";
import { runGetLogs } from "../services/get-logs";
import { runInit } from "../services/init";
import { runClientCheck } from "../services/client-check";
import { runServerCheck } from "../services/server-check";
import { runTestServerlog } from "../services/test-logger";

const KNOWN_COMMANDS = new Set([
  "init",
  "get-logs",
  "server-check",
  "client-check",
  "test-serverlog",
  "test-clientlog",
]);

function printUsage(): void {
  console.log("");
  console.log(chalk.bold.hex("#ffa657")("✨ Auralogger CLI") + chalk.dim(" — pick a command:"));
  console.log(chalk.hex("#7ee787")("  init") + chalk.dim("           wire up secrets + copy-paste client config"));
  console.log(chalk.hex("#7ee787")("  server-check") + chalk.dim("    make sure the server logger can talk"));
  console.log(chalk.hex("#7ee787")("  client-check") + chalk.dim("   same vibes, browser-style pipe"));
  console.log(chalk.hex("#7ee787")("  test-serverlog") + chalk.dim("  five fake server logs, just for kicks"));
  console.log(chalk.hex("#7ee787")("  test-clientlog") + chalk.dim("  five fake client logs, same deal"));
  console.log(chalk.hex("#7ee787")("  get-logs") + chalk.dim("       hunt past logs (filters optional)"));
  console.log("");
  console.log(chalk.dim("Docs live on npm: auralogger-cli — filter cheat sheet is there."));
  {
    const veteran = getTotalSuccessfulCommands() >= 4 && Math.random() < 0.28;
    const a = veteran
      ? pickAside(CLI_VETERAN_USAGE_ASIDES)
      : pickTieredAside({
          common: BIN_USAGE_ASIDES,
          rare: BIN_USAGE_RARE_MULTI_ASIDES,
          legendary: BIN_USAGE_LEGENDARY_ASIDES,
        });
    printAsideMaybe(a.emoji, a.line, DEFAULT_SILENCE_ASIDE_CHANCE);
  }
  console.log("");
}

async function main(): Promise<void> {
  loadCliEnvFiles();

  const args = process.argv.slice(2);
  const command = args[0];

  if (!command) {
    printUsage();
    return;
  }

  if (!KNOWN_COMMANDS.has(command)) {
    recordCliFailure();
    console.error(chalk.red("🤔 Hmm, never heard of ") + chalk.bold(command) + chalk.red("."));
    {
      const t = pickAside(BIN_UNKNOWN_COMMAND_TEMPLATES);
      printAsideMaybe(
        t.emoji,
        formatAsideTemplate(t.line, { cmd: command }),
        DEFAULT_SILENCE_ASIDE_CHANCE,
      );
    }
    printUsage();
    process.exitCode = 1;
    return;
  }

  noteCommandDispatch(command);

  if (command === "init") {
    await runInit();
    recordCliSuccess(command);
    return;
  }

  if (command === "get-logs") {
    await runGetLogs(args);
    recordCliSuccess(command);
    return;
  }

  if (command === "server-check") {
    await runServerCheck();
    recordCliSuccess(command);
    return;
  }

  if (command === "client-check") {
    await runClientCheck();
    recordCliSuccess(command);
    return;
  }

  if (command === "test-serverlog") {
    await runTestServerlog();
    recordCliSuccess(command);
    return;
  }

  if (command === "test-clientlog") {
    await runTestClientlog();
    recordCliSuccess(command);
    return;
  }
}

main().catch((error: unknown) => {
  recordCliFailure();
  const message = error instanceof Error ? error.message : String(error);
  console.error("");
  console.error(chalk.red.bold("💥 That didn't work."));
  console.error(chalk.dim("   ") + chalk.white(message));
  const fails = getConsecutiveFailures();
  if (fails >= 2 && Math.random() < 0.45) {
    const n = pickAside(WOLVERINE_NUDGE_ASIDES);
    printAside(n.emoji, n.line);
  }
  const aside = pickAdaptiveFatalAside(fails, message);
  // Crash path: bias toward showing the voice line (still useful, not buried in the red blob).
  printAsideMaybe(aside.emoji, aside.line, 0.08);
  const errKind = classifyErrorForAside(message);
  if (
    (errKind === "network" || errKind === "auth-env") &&
    Math.random() < 0.42
  ) {
    const e = pickAside(ENV_SETUP_RECOVERY_ASIDES);
    printAside(e.emoji, e.line);
  }
  maybePrintGenericSpice();
  process.exit(1);
});
