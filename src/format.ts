import type { BufferedLine } from "./ring-buffer.js";
import { frozenUptime, type WatchProcess } from "./process.js";

/** Plain JSON shape mirroring `ProcessSummarySchema` for codemode `structuredContent`. */
export type ProcessSummary = {
  id: string;
  name: string | null;
  command: string;
  args: string[];
  cwd: string;
  pid: number | null;
  running: boolean;
  uptime_sec: number;
  buffered_lines: number;
  latest_seq: number;
  latest_ts: number | null;
};

export type LineJson = {
  seq: number;
  source: BufferedLine["source"];
  text: string;
  ts: number;
};

export const formatLine = (l: BufferedLine): string =>
  `[${l.source}] ${l.text}`;

export const toLineJson = (l: BufferedLine): LineJson => ({
  seq: l.seq,
  source: l.source,
  text: l.text,
  ts: l.ts,
});

export const toProcessSummary = (proc: WatchProcess): ProcessSummary => ({
  id: proc.id,
  name: proc.name ?? null,
  command: proc.command,
  args: proc.args,
  cwd: proc.cwd,
  pid: proc.child?.pid ?? null,
  running: !proc.exited,
  uptime_sec: frozenUptime(proc),
  buffered_lines: proc.buffer.length(),
  latest_seq: proc.buffer.latestSeq(),
  latest_ts: proc.buffer.latestTs() ?? null,
});

export const formatProcessStatus = (proc: WatchProcess): string =>
  JSON.stringify(toProcessSummary(proc), null, 2);

export const formatProcessSummary = (proc: WatchProcess): string => {
  const label = proc.name ? `${proc.id} (${proc.name})` : proc.id;
  const cmd = `${proc.command} ${proc.args.join(" ")}`;
  const state = proc.exited ? "stopped" : "running";
  const uptime = `${frozenUptime(proc)}s`;
  return `${label}: ${cmd} — ${state}, uptime ${uptime}, pid ${proc.child?.pid ?? "n/a"}`;
};