import type { SystemTask } from "./categories";

/**
 * Next run of each background task, published by its scheduler when it arms
 * its timer (null: not scheduled, e.g. disabled). On `globalThis`: the
 * scheduler runs in the instrumentation bundle, the System health route reads
 * from another copy of this module. Unknown (undefined) until the server
 * process has started its schedulers.
 */
const globalForRuns = globalThis as unknown as { __hpNextRuns?: Map<SystemTask, Date | null> };
const nextRuns = (globalForRuns.__hpNextRuns ??= new Map());

export function setNextRun(task: SystemTask, at: Date | null): void {
  nextRuns.set(task, at);
}

export function getNextRun(task: SystemTask): Date | null | undefined {
  return nextRuns.get(task);
}
