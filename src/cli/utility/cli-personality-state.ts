/**
 * In-process session memory for CLI tone (resets each Node process).
 * Tracks consecutive failures, per-command attempts/successes for escalation + intent.
 */

let consecutiveFailures = 0;
const attemptCountByCommand: Record<string, number> = {};
const successCountByCommand: Record<string, number> = {};

export function noteCommandDispatch(command: string): void {
  attemptCountByCommand[command] = (attemptCountByCommand[command] ?? 0) + 1;
}

export function getCommandAttemptCount(command: string): number {
  return attemptCountByCommand[command] ?? 0;
}

export function recordCliSuccess(command: string): void {
  consecutiveFailures = 0;
  successCountByCommand[command] = (successCountByCommand[command] ?? 0) + 1;
}

export function recordCliFailure(): void {
  consecutiveFailures += 1;
}

export function getConsecutiveFailures(): number {
  return consecutiveFailures;
}

export function getSuccessfulRunCount(command: string): number {
  return successCountByCommand[command] ?? 0;
}

export function getTotalSuccessfulCommands(): number {
  let n = 0;
  for (const v of Object.values(successCountByCommand)) {
    n += v;
  }
  return n;
}
