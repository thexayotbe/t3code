import { isThreadWorking } from "@t3tools/client-runtime/state/thread-inbox";
import {
  effectiveSnoozed,
  hasUnseenRunFailure,
} from "@t3tools/client-runtime/state/thread-settled";
import { threadRuntimeIsActive } from "@t3tools/client-runtime/state/models";
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
  // Only a failure the user has not looked at yet; an old one is not waiting on anyone.
  if (hasUnseenRunFailure(thread)) return "failed";
  return null;
}

/** The same test the sidebar uses: parked by the user or auto-settled by the server. */
function isSettled(thread: EnvironmentThreadShell): boolean {
  return thread.settledOverride === "settled" || thread.settledAt != null;
}

function waitingSinceMs(thread: EnvironmentThreadShell, attention: NowAttention): number | null {
  if (attention === "failed") {
    return parseMs(thread.latestRun?.completedAt) ?? parseMs(thread.latestRun?.startedAt);
  }
  if (attention === "input") return parseMs(thread.pendingUserInputAt) ?? parseMs(thread.updatedAt);
  return parseMs(thread.runtime?.updatedAt) ?? parseMs(thread.updatedAt);
}

/** Splits threads into what the Now screen shows; everything else only counts as quiet. */
export function buildNowBoard(
  threads: ReadonlyArray<EnvironmentThreadShell>,
  nowMs: number,
): NowBoard {
  const nowIso = new Date(nowMs).toISOString();
  const needs: NowEntry[] = [];
  const running: NowEntry[] = [];
  const done: NowEntry[] = [];
  let quietCount = 0;

  for (const thread of threads) {
    if (thread.archivedAt != null || thread.deletedAt != null) continue;
    // Settled and snoozed threads are out of the inbox, so they stay out of Now too.
    if (isSettled(thread) || effectiveSnoozed(thread, { now: nowIso })) {
      quietCount += 1;
      continue;
    }
    const attention = nowAttention(thread);
    if (attention !== null) {
      needs.push({ thread, group: "needs", attention, sinceMs: waitingSinceMs(thread, attention) });
      continue;
    }
    // A run in flight (including one waiting on a tool or a queue), not an idle thread.
    if (threadRuntimeIsActive(thread.runtime) && isThreadWorking(thread)) {
      const since =
        parseMs(thread.runtime?.activityStartedAt) ?? parseMs(thread.latestRun?.startedAt);
      running.push({ thread, group: "running", attention: null, sinceMs: since });
      continue;
    }
    // Idle and not settled yet: finished work waiting for the user to look at it and settle it.
    const finishedMs = parseMs(thread.latestRun?.completedAt);
    if (thread.latestRun !== null && finishedMs !== null) {
      done.push({ thread, group: "done", attention: null, sinceMs: finishedMs });
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
