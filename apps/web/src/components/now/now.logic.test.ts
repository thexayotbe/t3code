import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import { describe, expect, it } from "vite-plus/test";

import { buildNowBoard, formatNowMinutes, nowAttention, waitRingMinutes } from "./now.logic";

const NOW = Date.parse("2026-11-24T12:00:00.000Z");
const iso = (minutesAgo: number) => new Date(NOW - minutesAgo * 60_000).toISOString();

function shell(
  id: string,
  overrides: Partial<EnvironmentThreadShell> = {},
): EnvironmentThreadShell {
  return {
    id,
    environmentId: "env",
    interactionMode: "default",
    latestRun: null,
    runtime: null,
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    hasActionableProposedPlan: false,
    updatedAt: iso(5),
    archivedAt: null,
    deletedAt: null,
    snoozedUntil: null,
    snoozedAt: null,
    ...overrides,
  } as unknown as EnvironmentThreadShell;
}

function runtime(status: string, updatedMinutesAgo = 1) {
  return {
    status,
    activeRunId: "run",
    activityStartedAt: iso(10),
    providerInstanceId: "p",
    providerName: null,
    lastError: null,
    updatedAt: iso(updatedMinutesAgo),
  } as unknown as EnvironmentThreadShell["runtime"];
}

function run(status: string, completedMinutesAgo: number | null = null) {
  return {
    runId: "run",
    status,
    requestedAt: null,
    startedAt: iso(30),
    completedAt: completedMinutesAgo === null ? null : iso(completedMinutesAgo),
    assistantMessageId: null,
  } as unknown as EnvironmentThreadShell["latestRun"];
}

describe("nowAttention", () => {
  it("ranks approvals before questions and plans", () => {
    expect(nowAttention(shell("a", { hasPendingApprovals: true, hasPendingUserInput: true }))).toBe(
      "approval",
    );
    expect(nowAttention(shell("b", { hasPendingUserInput: true }))).toBe("input");
    expect(
      nowAttention(shell("c", { interactionMode: "plan", hasActionableProposedPlan: true })),
    ).toBe("plan");
  });

  it("ignores a proposed plan outside plan mode", () => {
    expect(nowAttention(shell("d", { hasActionableProposedPlan: true }))).toBeNull();
  });

  it("flags a failed run", () => {
    expect(nowAttention(shell("e", { latestRun: run("failed", 3) }))).toBe("failed");
  });
});

describe("buildNowBoard", () => {
  it("groups needs, running and done today and counts the rest as quiet", () => {
    const board = buildNowBoard(
      [
        shell("needs", { hasPendingApprovals: true }),
        shell("running", { runtime: runtime("running"), latestRun: run("running") }),
        shell("done", { latestRun: run("completed", 20) }),
        shell("old", { latestRun: run("completed", 60 * 24 * 3) }),
        shell("never"),
      ],
      NOW,
    );
    expect(board.needs.map((entry) => entry.thread.id)).toEqual(["needs"]);
    expect(board.running.map((entry) => entry.thread.id)).toEqual(["running"]);
    expect(board.done.map((entry) => entry.thread.id)).toEqual(["done"]);
    expect(board.quietCount).toBe(2);
  });

  it("hides archived, deleted and snoozed threads", () => {
    const board = buildNowBoard(
      [
        shell("archived", { hasPendingApprovals: true, archivedAt: iso(1) }),
        shell("deleted", { hasPendingApprovals: true, deletedAt: iso(1) }),
        shell("snoozed", {
          latestRun: run("completed", 5),
          snoozedUntil: new Date(NOW + 3_600_000).toISOString(),
        }),
      ],
      NOW,
    );
    expect(board.needs).toEqual([]);
    expect(board.done).toEqual([]);
    expect(board.quietCount).toBe(1);
  });

  it("leads with the thread that has waited longest", () => {
    const board = buildNowBoard(
      [
        shell("recent", { hasPendingApprovals: true, runtime: runtime("waiting", 2) }),
        shell("oldest", { hasPendingApprovals: true, runtime: runtime("waiting", 40) }),
      ],
      NOW,
    );
    expect(board.needs.map((entry) => entry.thread.id)).toEqual(["oldest", "recent"]);
  });
});

describe("time formatting", () => {
  it("formats minutes, hours and days", () => {
    expect(formatNowMinutes(NOW - 5 * 60_000, NOW)).toBe("5m");
    expect(formatNowMinutes(NOW - 125 * 60_000, NOW)).toBe("2h");
    expect(formatNowMinutes(NOW - 50 * 3_600_000, NOW)).toBe("2d");
    expect(formatNowMinutes(null, NOW)).toBe("–");
  });

  it("never reports negative waits", () => {
    expect(waitRingMinutes(NOW + 60_000, NOW)).toBe(0);
  });
});
