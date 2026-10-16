import { spawn, type ChildProcess } from "node:child_process";
import { RingBuffer, type BufferedLine } from "./ring-buffer.js";
import { stripAnsi } from "./ansi.js";
import { resolveBinary } from "./binary.js";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface WatchProcess {
  id: string;
  name: string | undefined;
  command: string; // original command as passed by user
  resolvedPath: string; // actual binary path used for spawn
  args: string[];
  cwd: string;
  child: ChildProcess | undefined;
  exited: boolean;
  startTime: number; // Date.now() when started
  stopTime: number; // Date.now() when exited (0 while running)
  buffer: RingBuffer;
}

// ─── Process registry ────────────────────────────────────────────────────────
//
// The registry lives on `globalThis`, not in module scope, so it survives hot
// module replacement (`/reload`): the freshly loaded extension module adopts the
// still-running child processes and their ring buffers instead of leaking them
// or starting from zero. The `data`/`close` handlers attached to each child by
// the previous runtime keep writing into these same buffers.

interface WatchRegistry {
  processes: Map<string, WatchProcess>;
  nextProcNum: number;
}

const REGISTRY_KEY = Symbol.for("pi-watch-process.registry.v1");

const globalStore = globalThis as unknown as Record<symbol, WatchRegistry | undefined>;

const registry: WatchRegistry =
  globalStore[REGISTRY_KEY] ??
  (globalStore[REGISTRY_KEY] = {
    processes: new Map<string, WatchProcess>(),
    nextProcNum: 1,
  });

export const processes = registry.processes;

export const createId = (): string => `proc_${registry.nextProcNum++}`;

export const PRUNE_AGE_MS = 5 * 60 * 1000;

/** Remove processes that have been stopped for > 5 minutes. */
export function pruneStopped(): void {
  const now = Date.now();
  for (const [id, proc] of processes) {
    if (
      proc.exited &&
      proc.stopTime > 0 &&
      now - proc.stopTime > PRUNE_AGE_MS
    ) {
      processes.delete(id);
    }
  }
}

/**
 * Look up a process by ID or name.
 * Prefers running processes over stopped ones when resolving by name.
 */
export function resolveProcess(ref: string): WatchProcess | undefined {
  // Try by id first, then by name
  const byId = processes.get(ref);
  if (byId) return byId;
  // Prefer running processes over stopped ones when resolving by name
  let stopped: WatchProcess | undefined;
  for (const proc of processes.values()) {
    if (proc.name === ref) {
      if (!proc.exited) return proc;
      stopped = proc;
    }
  }
  return stopped;
}

// ─── Process lifecycle ───────────────────────────────────────────────────────

/**
 * Start a process. Returns true on success, false if the binary couldn't be
 * found (error already pushed to the buffer).
 */
export function startProcess(proc: WatchProcess): boolean {
  const binary = resolveBinary(proc.resolvedPath, proc.cwd);
  if (!binary) {
    proc.exited = true;
    proc.stopTime = Date.now();
    proc.startTime = Date.now();
    proc.buffer.push(
      "system",
      `✖ Command not found: "${proc.resolvedPath}". ` +
        `Is it installed? Try "npm install" or use "npx ${proc.resolvedPath}".`,
    );
    return false;
  }

  proc.exited = false;
  proc.stopTime = 0;
  proc.startTime = Date.now();
  proc.resolvedPath = binary;
  proc.buffer.push(
    "system",
    `▶ Starting: ${binary} ${proc.args.join(" ")}`,
  );

  const child = spawn(binary, proc.args, {
    cwd: proc.cwd,
    shell: process.platform === "win32",
    env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1" },
  });
  proc.child = child;

  const makeLineBuffer = (source: BufferedLine["source"]) => {
    let buf = "";
    return (data: Buffer) => {
      buf += data.toString();
      const parts = buf.split("\n");
      buf = parts.pop()!;
      for (const p of parts) {
        const c = stripAnsi(p).trimEnd();
        if (c) proc.buffer.push(source, c);
      }
    };
  };

  child.stdout.on("data", makeLineBuffer("stdout"));
  child.stderr.on("data", makeLineBuffer("stderr"));
  child.on("close", (code) => {
    proc.exited = true;
    proc.stopTime = Date.now();
    proc.buffer.push("system", `■ Exited: ${code ?? "unknown"}`);
  });
  child.on("error", (err) => {
    proc.exited = true;
    proc.stopTime = Date.now();
    proc.buffer.push("system", `✖ Error: ${err.message}`);
  });

  return true;
}

export async function stopProcess(proc: WatchProcess): Promise<void> {
  if (!proc.child || proc.exited) return;
  proc.buffer.push(
    "system",
    `⟳ Stopping: ${proc.id} (${proc.name ?? proc.command})`,
  );
  proc.child.kill("SIGTERM");
  await new Promise((r) => setTimeout(r, 500));
  if (!proc.exited) {
    proc.child.kill("SIGKILL");
    await new Promise((r) => setTimeout(r, 200));
    // Force-set exited if the close event hasn't fired (e.g. zombie process)
    if (!proc.exited) {
      proc.exited = true;
      proc.stopTime = Date.now();
      proc.buffer.push("system", `■ Force-stopped: ${proc.id}`);
    }
  }
}

export async function killAll(): Promise<void> {
  await Promise.allSettled(
    [...processes.values()].map((proc) => stopProcess(proc)),
  );
}

/**
 * Detach pending `watch_wait` listeners from every ring buffer while leaving
 * the child processes running. Called on hot module replacement so the next
 * runtime starts with a clean event bus but keeps the live processes.
 */
export function detachAllWaiters(): void {
  for (const proc of processes.values()) {
    proc.buffer.clearListeners();
  }
}

/** Number of processes that are still running. */
export function runningCount(): number {
  let n = 0;
  for (const proc of processes.values()) if (!proc.exited) n++;
  return n;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Compute frozen uptime: uses stopTime for exited processes, now for running ones. */
export function frozenUptime(proc: WatchProcess): number {
  const effectiveEnd = proc.stopTime > 0 ? proc.stopTime : Date.now();
  return proc.startTime > 0
    ? Math.floor((effectiveEnd - proc.startTime) / 1000)
    : 0;
}
