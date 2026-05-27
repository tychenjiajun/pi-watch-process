/**
 * watch — Pi extension to manage CLI watch-mode processes
 *
 * Start, monitor, and control long-running CLI processes (tsc --watch,
 * jest --watch, cargo watch, etc.) directly from pi's LLM tool calls.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "@sinclair/typebox";

// ─── Ring buffer ────────────────────────────────────────────────────────────

const MAX_LINES = 500;

interface BufferedLine {
  seq: number;
  source: "stdout" | "stderr" | "system";
  text: string;
  ts: number; // Date.now()
}

class RingBuffer {
  private lines: BufferedLine[] = [];
  private seq = 0;
  private bus = new EventEmitter();

  push(source: BufferedLine["source"], text: string): BufferedLine {
    const entry: BufferedLine = { seq: ++this.seq, source, text, ts: Date.now() };
    this.lines.push(entry);
    if (this.lines.length > MAX_LINES) this.lines.shift();
    this.bus.emit("line", entry);
    return entry;
  }

  getLines(sinceSeq?: number, sinceSecondsAgo?: number, limit?: number): BufferedLine[] {
    let filtered = this.lines;
    if (sinceSecondsAgo !== undefined && sinceSecondsAgo > 0) {
      const cutoff = Date.now() - sinceSecondsAgo * 1000;
      filtered = filtered.filter((l) => l.ts >= cutoff);
    }
    if (sinceSeq !== undefined && sinceSeq > 0) {
      filtered = filtered.filter((l) => l.seq > sinceSeq);
    }
    const cap = Math.min(limit ?? 50, 200);
    return filtered.slice(-cap);
  }

  latestSeq(): number {
    return this.seq;
  }

  latestTs(): number | undefined {
    return this.lines.length > 0 ? this.lines[this.lines.length - 1].ts : undefined;
  }

  length(): number {
    return this.lines.length;
  }

  waitForLine(
    sinceSeq: number,
    timeoutMs: number,
    match?: string,
    signal?: AbortSignal,
  ): Promise<BufferedLine[]> {
    const needle = match ? match.toLowerCase() : null;

    // Check existing lines first
    const existing = this.lines.filter(
      (l) => l.seq > sinceSeq && (!needle || l.text.toLowerCase().includes(needle)),
    );
    if (existing.length > 0) return Promise.resolve(existing);

    const collected: BufferedLine[] = [];

    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        cleanup();
        resolve(collected);
      }, timeoutMs);

      const onAbort = () => {
        cleanup();
        resolve(collected);
      };

      if (signal) {
        if (signal.aborted) {
          clearTimeout(timer);
          return resolve(collected);
        }
        signal.addEventListener("abort", onAbort, { once: true });
      }

      function handler(entry: BufferedLine) {
        if (entry.seq <= sinceSeq) return;
        collected.push(entry);
        if (!needle || entry.text.toLowerCase().includes(needle)) {
          cleanup();
          resolve(collected);
        }
      }

      this.bus.on("line", handler);

      const cleanup = () => {
        clearTimeout(timer);
        this.bus.off("line", handler);
        if (signal) signal.removeEventListener("abort", onAbort);
      };
    });
  }
}

// ─── ANSI stripping ──────────────────────────────────────────────────────────

const stripAnsi = (s: string): string =>
  s.replace(/\x1B\[[0-9;]*[A-Za-z]/g, "").replace(/\x1B\][^\x07]*\x07/g, "");

// ─── Process manager ─────────────────────────────────────────────────────────

let nextProcNum = 1;

interface WatchProcess {
  id: string;
  name: string | undefined;
  command: string;
  args: string[];
  cwd: string;
  child: ChildProcess | undefined;
  exited: boolean;
  startTime: number;
  buffer: RingBuffer;
}

const processes = new Map<string, WatchProcess>();

const createId = (): string => `proc_${nextProcNum++}`;

const resolveProcess = (ref: string): WatchProcess | undefined => {
  // Try by id first, then by name
  const byId = processes.get(ref);
  if (byId) return byId;
  for (const proc of processes.values()) {
    if (proc.name === ref) return proc;
  }
  return undefined;
};

const startProcess = (proc: WatchProcess): void => {
  proc.exited = false;
  proc.startTime = Date.now();
  proc.buffer.push("system", `▶ Starting: ${proc.command} ${proc.args.join(" ")}`);

  const child = spawn(proc.command, proc.args, {
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
    proc.buffer.push("system", `■ Exited: ${code ?? "unknown"}`);
  });
  child.on("error", (err) => {
    proc.exited = true;
    proc.buffer.push("system", `✖ Error: ${err.message}`);
  });
};

const stopProcess = async (proc: WatchProcess): Promise<void> => {
  if (!proc.child || proc.exited) return;
  proc.buffer.push("system", `⟳ Stopping: ${proc.id} (${proc.name ?? proc.command})`);
  proc.child.kill("SIGTERM");
  await new Promise((r) => setTimeout(r, 500));
  if (!proc.exited) proc.child.kill("SIGKILL");
  await new Promise((r) => setTimeout(r, 200));
};

const killAll = async (reason: string): Promise<void> => {
  await Promise.allSettled(
    [...processes.values()].map((proc) => stopProcess(proc)),
  );
};

// ─── Schemas ─────────────────────────────────────────────────────────────────

const SinceSeq = Type.Optional(
  Type.Number({ description: "Only return lines with seq > this value" }),
);

const SinceSecondsAgo = Type.Optional(
  Type.Number({
    description: "Only return lines from the last N seconds. Mutually exclusive with since_seq.",
  }),
);

const Limit = Type.Optional(
  Type.Number({ description: "Max lines to return (default 50, max 200)" }),
);

// watch_start
const WatchStartSchema = Type.Object({
  command: Type.String({ description: "Command to run (e.g. tsc, jest, cargo)" }),
  args: Type.Optional(
    Type.Array(Type.String(), { description: "Arguments to pass (e.g. [--watch, --no-coverage])" }),
  ),
  cwd: Type.Optional(Type.String({ description: "Working directory. Defaults to current project cwd." })),
  name: Type.Optional(Type.String({ description: "Human-readable name (e.g. tsc, jest). Must be unique." })),
});

// watch_stop
const WatchStopSchema = Type.Object({
  process: Type.String({ description: "Process ID or name to stop" }),
});

// watch_list (no params needed, use empty object)
const WatchListSchema = Type.Object({});

// watch_status
const WatchStatusSchema = Type.Object({
  process: Type.String({ description: "Process ID or name" }),
});

// watch_output
const WatchOutputSchema = Type.Object({
  process: Type.String({ description: "Process ID or name" }),
  since_seq: SinceSeq,
  since_seconds_ago: SinceSecondsAgo,
  limit: Limit,
});

// watch_wait
const WatchWaitSchema = Type.Object({
  process: Type.String({ description: "Process ID or name" }),
  since_seq: SinceSeq,
  since_seconds_ago: SinceSecondsAgo,
  timeout_ms: Type.Optional(
    Type.Number({ description: "Max wait in ms (default 15000, max 60000)" }),
  ),
  match: Type.Optional(
    Type.String({
      description: "Substring to wait for (case-insensitive). Returns as soon as a matching line appears.",
    }),
  ),
});

// watch_input
const WatchInputSchema = Type.Object({
  process: Type.String({ description: "Process ID or name" }),
  text: Type.String({ description: "Text to send (newline appended automatically)" }),
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

const formatLine = (l: BufferedLine): string => `[${l.source}] ${l.text}`;

const formatProcessStatus = (proc: WatchProcess): string =>
  JSON.stringify(
    {
      id: proc.id,
      name: proc.name ?? null,
      command: `${proc.command} ${proc.args.join(" ")}`,
      pid: proc.child?.pid ?? null,
      running: !proc.exited,
      uptime_sec: proc.startTime ? Math.floor((Date.now() - proc.startTime) / 1000) : 0,
      buffered_lines: proc.buffer.length(),
      latest_seq: proc.buffer.latestSeq(),
      latest_ts: proc.buffer.latestTs(),
    },
    null,
    2,
  );

const formatProcessSummary = (proc: WatchProcess): string => {
  const label = proc.name ? `${proc.id} (${proc.name})` : proc.id;
  const cmd = `${proc.command} ${proc.args.join(" ")}`;
  const state = proc.exited ? "stopped" : "running";
  const uptime = proc.startTime ? `${Math.floor((Date.now() - proc.startTime) / 1000)}s` : "0s";
  return `${label}: ${cmd} — ${state}, uptime ${uptime}, pid ${proc.child?.pid ?? "n/a"}`;
};

// ─── Extension ────────────────────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
  pi.on("session_shutdown", async () => {
    await killAll("Session shutting down");
  });

  pi.registerTool(
    defineTool({
      name: "watch_start",
      label: "Watch Start",
      description:
        "Start a CLI watch-mode process and return its ID. The process runs in the background; use watch_output, watch_status, and watch_wait to monitor it.",
      promptSnippet: "Start a long-running CLI process (e.g. tsc --watch, jest --watch) and monitor its output",
      promptGuidelines: [
        "Use watch_start to launch build/test/lint watchers, then watch_wait to block until they finish a cycle.",
        "Use watch_list to see all running processes, watch_output to poll incremental output, and watch_stop to terminate one.",
      ],
      parameters: WatchStartSchema,
      async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
        // Check for duplicate name
        if (params.name) {
          const existing = resolveProcess(params.name);
          if (existing && existing.name === params.name) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: `Error: name "${params.name}" is already used by process ${existing.id}. Choose a different name or omit name for an auto-generated ID.`,
                },
              ],
              details: {},
            };
          }
        }

        const id = createId();
        const proc: WatchProcess = {
          id,
          name: params.name ?? undefined,
          command: params.command,
          args: params.args ?? [],
          cwd: params.cwd ?? ctx.cwd,
          child: undefined,
          exited: false,
          startTime: 0,
          buffer: new RingBuffer(),
        };

        processes.set(id, proc);
        startProcess(proc);

        return {
          content: [
            {
              type: "text" as const,
              text: `Started process ${id} (${proc.name ?? proc.command}). PID: ${proc.child?.pid ?? "n/a"}\nCommand: ${proc.command} ${proc.args.join(" ")}\nCWD: ${proc.cwd}`,
            },
          ],
          details: {},
        };
      },
    }),
  );

  pi.registerTool(
    defineTool({
      name: "watch_stop",
      label: "Watch Stop",
      description: "Stop a running watch process by ID or name.",
      parameters: WatchStopSchema,
      async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
        const proc = resolveProcess(params.process);
        if (!proc) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Error: no process found for "${params.process}". Use watch_list to see available processes.`,
              },
            ],
            details: {},
          };
        }

        await stopProcess(proc);
        return {
          content: [
            {
              type: "text" as const,
              text: `Stopped process ${proc.id} (${proc.name ?? proc.command}).`,
            },
          ],
          details: {},
        };
      },
    }),
  );

  pi.registerTool(
    defineTool({
      name: "watch_list",
      label: "Watch List",
      description: "List all tracked watch processes and their status.",
      parameters: WatchListSchema,
      async execute(_toolCallId, _params, _signal, _onUpdate, _ctx) {
        const list = [...processes.values()];
        if (list.length === 0) {
          return {
            content: [{ type: "text" as const, text: "No watch processes running. Use watch_start to launch one." }],
            details: {},
          };
        }
        return {
          content: [
            {
              type: "text" as const,
              text: list.map(formatProcessSummary).join("\n"),
            },
          ],
          details: {},
        };
      },
    }),
  );

  pi.registerTool(
    defineTool({
      name: "watch_status",
      label: "Watch Status",
      description: "Get detailed status of a specific watch process.",
      parameters: WatchStatusSchema,
      async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
        const proc = resolveProcess(params.process);
        if (!proc) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Error: no process found for "${params.process}". Use watch_list to see available processes.`,
              },
            ],
            details: {},
          };
        }
        return {
          content: [{ type: "text" as const, text: formatProcessStatus(proc) }],
          details: {},
        };
      },
    }),
  );

  pi.registerTool(
    defineTool({
      name: "watch_output",
      label: "Watch Output",
      description:
        "Get recent output from a watch process. Use since_seq for incremental polling or since_seconds_ago for time-based queries.",
      parameters: WatchOutputSchema,
      async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
        const proc = resolveProcess(params.process);
        if (!proc) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Error: no process found for "${params.process}". Use watch_list to see available processes.`,
              },
            ],
            details: {},
          };
        }

        const slice = proc.buffer.getLines(
          params.since_seq,
          params.since_seconds_ago,
          params.limit,
        );

        return {
          content: [
            {
              type: "text" as const,
              text: slice.length === 0
                ? "(no new output)"
                : slice.map(formatLine).join("\n"),
            },
          ],
          details: {},
        };
      },
    }),
  );

  pi.registerTool(
    defineTool({
      name: "watch_wait",
      label: "Watch Wait",
      description:
        "Block until new output arrives from a watch process, optionally waiting for a specific substring match. Ideal for waiting for a build or test cycle to complete.",
      parameters: WatchWaitSchema,
      async execute(_toolCallId, params, signal, _onUpdate, _ctx) {
        const proc = resolveProcess(params.process);
        if (!proc) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Error: no process found for "${params.process}". Use watch_list to see available processes.`,
              },
            ],
            details: {},
          };
        }

        const timeout = Math.min(params.timeout_ms ?? 15000, 60000);
        const sinceSeq = params.since_seq ?? proc.buffer.latestSeq();
        // If since_seconds_ago is provided, compute the equivalent seq
        // by finding the first line with ts >= cutoff
        let effectiveSinceSeq = sinceSeq;
        if (params.since_seconds_ago !== undefined && params.since_seconds_ago > 0) {
          const cutoff = Date.now() - params.since_seconds_ago * 1000;
          const firstInRange = proc.buffer
            .getLines(undefined, params.since_seconds_ago, MAX_LINES)
            .find((l) => l.ts >= cutoff);
          if (firstInRange) {
            effectiveSinceSeq = firstInRange.seq - 1; // we want lines after the cutoff
          }
          // If no lines in range, use current latestSeq (wait for future lines)
        }

        const collected = await proc.buffer.waitForLine(
          effectiveSinceSeq,
          timeout,
          params.match,
          signal,
        );

        return {
          content: [
            {
              type: "text" as const,
              text: collected.length === 0
                ? "(timeout — no new output)"
                : collected.map(formatLine).join("\n"),
            },
          ],
          details: {},
        };
      },
    }),
  );

  pi.registerTool(
    defineTool({
      name: "watch_input",
      label: "Watch Input",
      description: "Send a line of text to a watch process's stdin (e.g. to answer interactive prompts).",
      parameters: WatchInputSchema,
      async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
        const proc = resolveProcess(params.process);
        if (!proc) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Error: no process found for "${params.process}". Use watch_list to see available processes.`,
              },
            ],
            details: {},
          };
        }
        if (!proc.child || proc.exited) {
          return {
            content: [{ type: "text" as const, text: "Error: process is not running." }],
            details: {},
          };
        }
        proc.child.stdin?.write(params.text + "\n");
        proc.buffer.push("system", `◀ stdin: ${params.text}`);
        return {
          content: [{ type: "text" as const, text: "Input sent." }],
          details: {},
        };
      },
    }),
  );
}