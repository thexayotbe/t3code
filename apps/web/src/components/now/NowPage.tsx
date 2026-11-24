import "@fontsource/doto/latin-900.css";
import "./now.css";

import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import { useNavigate } from "@tanstack/react-router";
import { ArrowUpRightIcon, XIcon } from "lucide-react";
import { T, useGT } from "gt-react";
import { useEffect, useState, type KeyboardEvent, type ReactNode } from "react";

import { isElectron } from "../../env";
import { useProjects, useVisibleThreadShells } from "../../state/entities";
import { buildThreadRouteParams } from "../../threadRoutes";
import { useNavigateToMainApp } from "../sidebar/mainAppLocation";
import { NowNeedsActions } from "./NowNeedsActions";
import {
  buildNowBoard,
  formatNowMinutes,
  waitRingMinutes,
  type NowAttention,
  type NowEntry,
} from "./now.logic";

const HOT = "#ff4d1f";
const TICK_MS = 15_000;
const CARD_SELECTOR = '[data-now~="card"]';

function useNowMs(): number {
  const [now, setNow] = useState(() => Date.now());
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- interval timer re-renders relative times while mounted
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), TICK_MS);
    return () => window.clearInterval(id);
  }, []);
  return now;
}

function hashSeed(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) % 1000;
  }
  return hash;
}

function DotRing(props: { readonly minutes: number; readonly filled: boolean }) {
  const count = 44;
  const lit = Math.round((count * Math.min(props.minutes, 15)) / 15);
  const dots = Array.from({ length: count }, (_, index) => {
    const angle = (index / count) * Math.PI * 2 - Math.PI / 2;
    const on = index < lit;
    const fill = props.filled ? (on ? "#1a0600" : "#1a060040") : on ? HOT : "#ffffff2a";
    return (
      <circle
        key={index}
        cx={44 + 34 * Math.cos(angle)}
        cy={44 + 34 * Math.sin(angle)}
        r={on ? 1.9 : 1.2}
        fill={fill}
      />
    );
  });
  return (
    <svg width="88" height="88" viewBox="0 0 88 88" aria-hidden="true">
      {dots}
      <text
        x="44"
        y="51"
        textAnchor="middle"
        fontFamily="Doto, monospace"
        fontWeight={900}
        fontSize="20"
        fill={props.filled ? "#1a0600" : "#f2f1ee"}
      >
        {props.minutes}m
      </text>
    </svg>
  );
}

function DotBars(props: { readonly seed: number }) {
  const dots: ReactNode[] = [];
  for (let column = 0; column < 20; column += 1) {
    const height = 2 + Math.floor(Math.abs(Math.sin(column * 1.7 + props.seed)) * 6);
    for (let row = 0; row < 7; row += 1) {
      dots.push(
        <circle
          key={`${column}-${row}`}
          cx={5 + column * 9.2}
          cy={60 - row * 8.5}
          r="1.7"
          fill={row < height ? (column > 16 ? HOT : "#d7dbe2") : "#ffffff12"}
        />,
      );
    }
  }
  return (
    <svg width="186" height="66" viewBox="0 0 186 66" aria-hidden="true">
      {dots}
    </svg>
  );
}

function attentionLabel(attention: NowAttention, gt: ReturnType<typeof useGT>): string {
  switch (attention) {
    case "approval":
      return gt("Permission");
    case "input":
      return gt("Question");
    case "plan":
      return gt("Plan ready");
    case "subagent":
      return gt("Sub-agent");
    case "guest":
      return gt("Guest message");
    case "failed":
      return gt("Failed");
  }
}

function Stat(props: { readonly label: string; readonly value: string }) {
  return (
    <span data-now="stat">
      <span data-now="mono">{props.label}</span>
      <span data-now="dot stat-value">{props.value}</span>
    </span>
  );
}

function NowCard(props: {
  readonly entry: NowEntry;
  readonly projectName: string;
  readonly hottest: boolean;
  readonly nowMs: number;
  readonly onOpen: (thread: EnvironmentThreadShell) => void;
}) {
  const gt = useGT();
  const { entry, nowMs } = props;
  const { thread } = entry;
  const filled = props.hottest && entry.group === "needs";
  const inline = entry.attention === "approval" || entry.attention === "input";

  const open = () => props.onOpen(thread);
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.target === event.currentTarget && event.key === "Enter") {
      event.preventDefault();
      open();
    }
  };

  return (
    <div data-now="wrap">
      <article
        data-now="card"
        data-fill={filled}
        data-group={entry.group}
        tabIndex={0}
        onKeyDown={onKeyDown}
      >
        <span data-now="mono">{props.projectName}</span>
        <h3>
          <button type="button" data-now="title" onClick={open}>
            {thread.title}
          </button>
        </h3>
        {entry.group === "needs" ? (
          <>
            {inline ? (
              <NowNeedsActions thread={thread} />
            ) : (
              <>
                <span data-now="hint">
                  {thread.runtime?.lastError ?? gt("Open the thread to respond.")}
                </span>
                <span data-now="viz">
                  <DotRing minutes={waitRingMinutes(entry.sinceMs, nowMs)} filled={filled} />
                </span>
              </>
            )}
            <span data-now="foot">
              <span data-now="chip">
                {entry.attention ? attentionLabel(entry.attention, gt) : null}
              </span>
              <span data-now="chip" data-hot="true">
                {gt("waiting")} {formatNowMinutes(entry.sinceMs, nowMs)}
              </span>
            </span>
          </>
        ) : entry.group === "running" ? (
          <>
            <span data-now="viz">
              <DotBars seed={hashSeed(thread.id) + Math.floor(nowMs / 60_000)} />
            </span>
            <span data-now="foot">
              <Stat label={gt("Doing")} value={thread.runtime?.status ?? "–"} />
              <Stat label={gt("Items")} value={String(thread.visibleItemCount)} />
              <Stat label={gt("Time")} value={formatNowMinutes(entry.sinceMs, nowMs)} />
            </span>
          </>
        ) : (
          <>
            <span data-now="viz" />
            <span data-now="foot">
              <Stat
                label={gt("Finished")}
                value={`${formatNowMinutes(entry.sinceMs, nowMs)} ${gt("ago")}`}
              />
            </span>
          </>
        )}
      </article>
      <button
        type="button"
        data-now="go"
        data-fill={filled}
        aria-label={gt("Open thread")}
        onClick={open}
      >
        <ArrowUpRightIcon size={15} color="#f2f1ee" />
      </button>
    </div>
  );
}

function Counter(props: {
  readonly value: number;
  readonly label: string;
  readonly color: string;
  readonly dim?: boolean;
}) {
  return (
    <div data-now="num">
      <b data-now="dot" style={props.dim ? { color: "#7c7b80" } : undefined}>
        {String(props.value).padStart(2, "0")}
      </b>
      <small>
        <i style={{ background: props.color }} />
        {props.label}
      </small>
    </div>
  );
}

function SectionHeader(props: {
  readonly title: string;
  readonly count: number;
  readonly countColor?: string;
  readonly children?: ReactNode;
}) {
  return (
    <div data-now="sec">
      <span data-now="sec-title">
        {props.title}
        <em data-now="dot" style={props.countColor ? { color: props.countColor } : undefined}>
          {props.count}
        </em>
      </span>
      <span data-now="grow" />
      {props.children}
    </div>
  );
}

function Pill(props: {
  readonly active: boolean;
  readonly onClick: () => void;
  readonly children: ReactNode;
}) {
  return (
    <button type="button" data-now="pill" data-active={props.active} onClick={props.onClick}>
      {props.children}
    </button>
  );
}

function isTypingTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)
  );
}

export function NowPage() {
  const gt = useGT();
  const navigate = useNavigate();
  const navigateToMainApp = useNavigateToMainApp();
  const threads = useVisibleThreadShells();
  const projects = useProjects();
  const nowMs = useNowMs();
  const [projectFilter, setProjectFilter] = useState<string | null>(null);

  const close = () => void navigateToMainApp();
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- window key listener (Esc closes the screen) removed on unmount
  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      if (isTypingTarget(event.target)) {
        (event.target as HTMLElement).blur();
        return;
      }
      event.preventDefault();
      void navigateToMainApp();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [navigateToMainApp]);

  const projectNames = new Map<string, string>();
  for (const project of projects) {
    projectNames.set(`${project.environmentId}:${project.id}`, project.title);
  }
  const nameOf = (thread: EnvironmentThreadShell) =>
    projectNames.get(`${thread.environmentId}:${thread.projectId}`) ?? "";

  const board = buildNowBoard(threads, nowMs);
  const projectOptions = [
    ...new Set(
      [...board.needs, ...board.running, ...board.done].map((entry) => nameOf(entry.thread)),
    ),
  ]
    .filter((name) => name !== "")
    .toSorted((a, b) => a.localeCompare(b));

  const visible = (entries: ReadonlyArray<NowEntry>) =>
    projectFilter === null
      ? entries
      : entries.filter((entry) => nameOf(entry.thread) === projectFilter);
  const needs = visible(board.needs);
  const running = visible(board.running);
  const done = visible(board.done);

  const openThread = (thread: EnvironmentThreadShell) => {
    void navigate({
      to: "/$environmentId/$threadId",
      params: buildThreadRouteParams(scopeThreadRef(thread.environmentId, thread.id)),
    });
  };

  // Arrow keys walk the cards in reading order while a card (not a field inside one) has focus.
  const onScreenKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    const target = event.target as HTMLElement;
    if (!target.matches(CARD_SELECTOR)) return;
    const step =
      event.key === "ArrowRight" || event.key === "ArrowDown"
        ? 1
        : event.key === "ArrowLeft" || event.key === "ArrowUp"
          ? -1
          : 0;
    if (step === 0) return;
    const cards = [...event.currentTarget.querySelectorAll<HTMLElement>(CARD_SELECTOR)];
    const next = cards[cards.indexOf(target) + step];
    if (next === undefined) return;
    event.preventDefault();
    next.focus();
    next.scrollIntoView({ block: "nearest" });
  };

  const renderCard = (entry: NowEntry, hottest: boolean) => (
    <NowCard
      key={`${entry.thread.environmentId}:${entry.thread.id}`}
      entry={entry}
      projectName={nameOf(entry.thread)}
      hottest={hottest}
      nowMs={nowMs}
      onOpen={openThread}
    />
  );

  return (
    <div data-now="screen" onKeyDown={onScreenKeyDown}>
      <header data-now="bar" data-electron={isElectron}>
        <div>
          <h1 data-now="dot title-big">NOW</h1>
          <div data-now="mono" style={{ marginTop: 6 }}>
            {new Date(nowMs).toLocaleString(undefined, {
              weekday: "short",
              day: "numeric",
              month: "short",
              hour: "2-digit",
              minute: "2-digit",
            })}
          </div>
        </div>
        <div data-now="nums">
          <Counter value={board.needs.length} label={gt("need you")} color={HOT} />
          <Counter value={board.running.length} label={gt("running")} color="#d7dbe2" />
          <Counter value={board.done.length} label={gt("done today")} color="#555" dim />
        </div>
        <span data-now="grow" />
        <div data-now="pills">
          <Pill active={projectFilter === null} onClick={() => setProjectFilter(null)}>
            <T>All</T>
          </Pill>
          {projectOptions.map((name) => (
            <Pill key={name} active={projectFilter === name} onClick={() => setProjectFilter(name)}>
              {name}
            </Pill>
          ))}
        </div>
        <button type="button" data-now="close" aria-label={gt("Close Now")} onClick={close}>
          <XIcon size={16} />
          <span data-now="mono">Esc</span>
        </button>
      </header>

      <main data-now="body">
        <SectionHeader title={gt("Your turn")} count={needs.length} countColor={HOT} />
        {needs.length > 0 ? (
          <div data-now="grid">{needs.map((entry, index) => renderCard(entry, index === 0))}</div>
        ) : (
          <div data-now="empty">
            <T>Nothing is waiting on you.</T>
          </div>
        )}

        <SectionHeader title={gt("Running")} count={running.length}>
          <span data-now="mono">
            {board.quietCount} {gt("quiet threads hidden")}
          </span>
        </SectionHeader>
        {running.length > 0 ? (
          <div data-now="grid">{running.map((entry) => renderCard(entry, false))}</div>
        ) : (
          <div data-now="empty">
            <T>Nothing is running.</T>
          </div>
        )}

        {done.length > 0 ? (
          <>
            <SectionHeader title={gt("Done today")} count={done.length} />
            <div data-now="grid">{done.map((entry) => renderCard(entry, false))}</div>
          </>
        ) : null}
      </main>
    </div>
  );
}
