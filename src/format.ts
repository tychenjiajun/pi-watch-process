import type { BufferedLine } from "./ring-buffer.js";
import { frozenUptime, type WatchProcess } from "./process.js";

export const formatLine = (l: BufferedLine): string =>
  `[${l.source}] ${l.text}`;

export const formatProcessStatus = (proc: WatchProcess): string =>
  JSON.stringify(
    {
      id: proc.id,
      name: proc.name ?? null,
      command: `${proc.command} ${proc.args.join(" ")}`,
      pid: proc.child?.pid ?? null,
      running: !proc.exited,
      uptime_sec: frozenUptime(proc),
      buffered_lines: proc.buffer.length(),
      latest_seq: proc.buffer.latestSeq(),
      latest_ts: proc.buffer.latestTs(),
    },
    null,
    2,
  );

export const formatProcessSummary = (proc: WatchProcess): string => {
  const label = proc.name ? `${proc.id} (${proc.name})` : proc.id;
  const cmd = `${proc.command} ${proc.args.join(" ")}`;
  const state = proc.exited ? "stopped" : "running";
  const uptime = `${frozenUptime(proc)}s`;
  return `${label}: ${cmd} — ${state}, uptime ${uptime}, pid ${proc.child?.pid ?? "n/a"}`;
};
