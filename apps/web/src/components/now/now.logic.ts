import { isThreadWorking } from "@t3tools/client-runtime/state/thread-inbox";
import { effectiveSnoozed } from "@t3tools/client-runtime/state/thread-settled";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";

export type NowAttention = "approval" | "input" | "plan" | "subagent" | "guest" | "failed";
export type NowGroup = "needs" | "running" | "done";

export interface NowEntry {
  readonly thread: EnvironmentThreadShell;
  readonly group: NowGroup;
  /** Set for `needs` entries; the reason the thread is waiting on the user. */
  readonly attention: NowAttention | null;
  /** When the thread started waiting (needs) or running (running); null when unknown. */
  readonly sinceMs: number | null;
}

export interface NowBoard {
  readonly needs: ReadonlyArray<NowEntry>;
  readonly running: ReadonlyArray<NowEntry>;
  readonly done: ReadonlyArray<NowEntry>;
  /** Threads that are neither waiting, running nor done today. */
  readonly quietCount: number;
}

function parseMs(value: string | null | undefined): number | null {
  if (value == null) return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : ms;
}

export function nowAttention(thread: EnvironmentThreadShell): NowAttention | null {
  if (thread.hasPendingApprovals) return "approval";
  if (thread.hasPendingUserInput) return "input";
  if (thread.pendingSubagentRequest != null) return "subagent";
  if (thread.interactionMode === "plan" && thread.hasActionableProposedPlan) return "plan";
  if ((thread.pendingGuestMessageCount ?? 0) > 0) return "guest";
  if (thread.runtime?.lastError != null || thread.latestRun?.status === "failed") return "failed";
  return null;
}

function startOfLocalDay(nowMs: number): number {
  const date = new Date(nowMs);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function waitingSinceMs(thread: EnvironmentThreadShell, attention: NowAttention): number | null {
  if (attention === "input") return parseMs(thread.pendingUserInputAt) ?? parseMs(thread.updatedAt);
  return parseMs(thread.runtime?.updatedAt) ?? parseMs(thread.updatedAt);
}

/** Splits threads into what the Now screen shows; everything else only counts as quiet. */
export function buildNowBoard(
  threads: ReadonlyArray<EnvironmentThreadShell>,
  nowMs: number,
): NowBoard {
  const nowIso = new Date(nowMs).toISOString();
  const dayStart = startOfLocalDay(nowMs);
  const needs: NowEntry[] = [];
  const running: NowEntry[] = [];
  const done: NowEntry[] = [];
  let quietCount = 0;

  for (const thread of threads) {
    if (thread.archivedAt != null || thread.deletedAt != null) continue;
    if (effectiveSnoozed(thread, { now: nowIso })) {
      quietCount += 1;
      continue;
    }
    const attention = nowAttention(thread);
    if (attention !== null) {
      needs.push({ thread, group: "needs", attention, sinceMs: waitingSinceMs(thread, attention) });
      continue;
    }
    if (isThreadWorking(thread) && thread.runtime?.status !== "idle") {
      const since =
        parseMs(thread.runtime?.activityStartedAt) ?? parseMs(thread.latestRun?.startedAt);
      running.push({ thread, group: "running", attention: null, sinceMs: since });
      continue;
    }
    const completedMs = parseMs(thread.latestRun?.completedAt);
    if (
      thread.latestRun?.status === "completed" &&
      completedMs !== null &&
      completedMs >= dayStart
    ) {
      done.push({ thread, group: "done", attention: null, sinceMs: completedMs });
      continue;
    }
    quietCount += 1;
  }

  // Longest-waiting first, so the thing you have kept waiting longest leads.
  needs.sort((a, b) => (a.sinceMs ?? Infinity) - (b.sinceMs ?? Infinity));
  running.sort((a, b) => (b.sinceMs ?? 0) - (a.sinceMs ?? 0));
  done.sort((a, b) => (b.sinceMs ?? 0) - (a.sinceMs ?? 0));
  return { needs, running, done, quietCount };
}

export function formatNowMinutes(sinceMs: number | null, nowMs: number): string {
  if (sinceMs === null) return "–";
  const minutes = Math.max(0, Math.floor((nowMs - sinceMs) / 60_000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours}h` : `${Math.floor(hours / 24)}d`;
}

/** Whole minutes waited, capped to the dotted ring's capacity. */
export function waitRingMinutes(sinceMs: number | null, nowMs: number): number {
  if (sinceMs === null) return 0;
  return Math.max(0, Math.floor((nowMs - sinceMs) / 60_000));
}
