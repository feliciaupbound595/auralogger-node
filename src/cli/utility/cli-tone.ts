import chalk from "chalk";

import {
  DEFAULT_SILENCE_ASIDE_CHANCE,
  GENERIC_SPICE_DEADPOOL_ASIDES,
  pickAside,
} from "./aside-pools";

/** Short vibe line: what's going on, what to do next, or a win — keeps the main output factual. */
export function printAside(emoji: string, line: string): void {
  console.log(chalk.dim(`     ${emoji} `) + chalk.italic.hex("#8b949e")(line));
}

/**
 * Sometimes skip the aside so jokes land harder (fatigue control).
 * @returns whether a line was printed
 */
export function printAsideMaybe(
  emoji: string,
  line: string,
  silenceChance: number = DEFAULT_SILENCE_ASIDE_CHANCE,
): boolean {
  if (Math.random() < silenceChance) {
    return false;
  }
  printAside(emoji, line);
  return true;
}

/** ~20%: light Deadpool roast after a win (keeps the tool useful, adds chaos). */
export function maybePrintGenericSpice(chance = 0.2): void {
  if (Math.random() >= chance) {
    return;
  }
  const a = pickAside(GENERIC_SPICE_DEADPOOL_ASIDES);
  printAside(a.emoji, a.line);
}
