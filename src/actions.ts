import {
  RingBuffer,
  DEFAULT_MAX_LINES,
  type BufferedLine,
  type LineSource,
} from "./ring-buffer.js";
import {
  processes,
  createId,
  resolveProcess,
  pruneStopped,
  startProcess,
  stopProcess,
  type WatchProcess,
} from "./process.js";

// ─── Result type ─────────────────────────────────────────────────────────────

type Ok<T> = { ok: true; value: T };
type Err = { ok: false; error: string };
type Result<T> = Ok<T> | Err;

/** Default cap for watch_wait timeout to prevent hanging prompts. */
const MAX_WAIT_TIMEOUT_MS = 60_000;

// ─── Actions ─────────────────────────────────────────────────────────────────

export function actionStart(params: {
  command: string;
  args: string[];
  cwd: string;
  name?: string;
  bufferSize?: number;
}): Result<WatchProcess> {
  pruneStopped();

  // Check for duplicate name (remove stopped duplicates, reject running ones)
  if (params.name) {
    const existing = resolveProcess(params.name);
    if (existing && existing.name === params.name) {
      if (!existing.exited) {
        return {
          ok: false,
          error: `name "${params.name}" is already used by running process ${existing.id}. Choose a different name or stop the existing process first.`,
        };
      }
      // Remove stopped process with duplicate name to avoid ambiguity
      processes.delete(existing.id);
    }
  }

  const id = createId();
  const bufferSize = params.bufferSize ?? DEFAULT_MAX_LINES;
  const proc: WatchProcess = {
    id,
    name: params.name,
    command: params.command,
    resolvedPath: params.command,
    args: params.args,
    cwd: params.cwd,
    child: undefined,
    exited: false,
    startTime: 0,
    stopTime: 0,
    buffer: new RingBuffer(bufferSize),
  };

  processes.set(id, proc);
  const ok = startProcess(proc);

  if (!ok) {
    return {
      ok: false,
      error: `command "${params.command}" not found in node_modules/.bin or PATH. Is it installed? Use "npx ${params.command}" as the command if you need to auto-install.`,
    };
  }

  return { ok: true, value: proc };
}

export async function actionStop(
  ref: string,
): Promise<Result<{ process: WatchProcess; wasRunning: boolean }>> {
  pruneStopped();
  const proc = resolveProcess(ref);
  if (!proc) {
    return {
      ok: false,
      error: `no process found for "${ref}". Use watch_list to see available processes.`,
    };
  }
  const wasRunning = !proc.exited;
  await stopProcess(proc);
  return { ok: true, value: { process: proc, wasRunning } };
}

/**
 * Hot-restart a process in place: stop it, keep the same id/name/buffer, then
 * spawn it again. This is the HMR primitive of the harness — after editing a
 * watched config or when a watcher wedges, restart it without losing its
 * history or identity.
 */
export async function actionRestart(ref: string): Promise<Result<WatchProcess>> {
  pruneStopped();
  const proc = resolveProcess(ref);
  if (!proc) {
    return {
      ok: false,
      error: `no process found for "${ref}". Use watch_list to see available processes.`,
    };
  }

  await stopProcess(proc);

  const ok = startProcess(proc);
  if (!ok) {
    return {
      ok: false,
      error: `command "${proc.resolvedPath}" could not be restarted — it is no longer reachable in node_modules/.bin or PATH.`,
    };
  }

  return { ok: true, value: proc };
}

export function actionList(includeCompleted: boolean): WatchProcess[] {
  pruneStopped();
  const all = [...processes.values()];
  return includeCompleted ? all : all.filter((p) => !p.exited);
}

export function actionStatus(ref: string): Result<WatchProcess> {
  const proc = resolveProcess(ref);
  if (!proc) {
    return {
      ok: false,
      error: `no process found for "${ref}". Use watch_list to see available processes.`,
    };
  }
  return { ok: true, value: proc };
}

export interface OutputSlice {
  empty: boolean;
  lines: BufferedLine[];
  process: WatchProcess;
}

export function actionOutput(params: {
  process: string;
  since_seq?: number;
  since_seconds_ago?: number;
  limit?: number;
  sources?: LineSource[];
}): Result<OutputSlice> {
  const proc = resolveProcess(params.process);
  if (!proc) {
    return {
      ok: false,
      error: `no process found for "${params.process}". Use watch_list to see available processes.`,
    };
  }

  const slice = proc.buffer.getLines(
    params.since_seq,
    params.since_seconds_ago,
    params.limit,
    params.sources,
  );

  return {
    ok: true,
    value: { empty: slice.length === 0, lines: slice, process: proc },
  };
}

export interface WaitSlice extends OutputSlice {
  matched: boolean;
  timedOut: boolean;
}

export async function actionWait(params: {
  process: string;
  since_seq?: number;
  since_seconds_ago?: number;
  timeout_ms?: number;
  match?: string;
  matchRegex?: string;
  sources?: LineSource[];
  signal?: AbortSignal;
}): Promise<Result<WaitSlice>> {
  const proc = resolveProcess(params.process);
  if (!proc) {
    return {
      ok: false,
      error: `no process found for "${params.process}". Use watch_list to see available processes.`,
    };
  }

  const timeout = Math.min(params.timeout_ms ?? 15000, MAX_WAIT_TIMEOUT_MS);
  const sinceSeq = params.since_seq ?? proc.buffer.latestSeq();

  // If since_seconds_ago is provided, compute the equivalent seq
  // by finding the first line with ts >= cutoff in the full buffer
  let effectiveSinceSeq = sinceSeq;
  if (params.since_seconds_ago !== undefined && params.since_seconds_ago > 0) {
    const seq = proc.buffer.firstSeqSince(params.since_seconds_ago);
    if (seq !== undefined) {
      effectiveSinceSeq = seq;
    }
  }

  // Validate matchRegex before passing to waitForLine
  if (params.matchRegex) {
    try {
      new RegExp(params.matchRegex, "i");
    } catch {
      return {
        ok: false,
        error: `Invalid regex pattern: "${params.matchRegex}". Check the syntax and try again.`,
      };
    }
  }

  const result = await proc.buffer.waitForLine(
    effectiveSinceSeq,
    timeout,
    params.match,
    params.signal,
    params.matchRegex,
    params.sources,
  );

  return {
    ok: true,
    value: {
      empty: result.lines.length === 0,
      lines: result.lines,
      process: proc,
      matched: result.matched,
      timedOut: result.timedOut,
    },
  };
}

export function actionInput(
  ref: string,
  text: string,
): Result<WatchProcess> {
  const proc = resolveProcess(ref);
  if (!proc) {
    return {
      ok: false,
      error: `no process found for "${ref}". Use watch_list to see available processes.`,
    };
  }
  if (!proc.child || proc.exited) {
    return { ok: false, error: "process is not running." };
  }
  if (!proc.child.stdin) {
    return {
      ok: false,
      error: "process stdin is not available (process was spawned without stdin).",
    };
  }
  proc.child.stdin.write(text + "\n");
  proc.buffer.push("system", `◀ stdin: ${text}`);
  return { ok: true, value: proc };
}