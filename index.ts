/**
 * watch — Pi extension to manage CLI watch-mode processes
 *
 * Start, monitor, control, and hot-restart long-running CLI processes
 * (tsc --watch, jest --watch, cargo watch, etc.) from pi's LLM tool calls or
 * from codemode scripts.
 *
 * Every tool declares an `outputSchema` and returns `structuredContent`, so
 * codemode scripts receive data instead of parsing text. The process registry
 * lives on `globalThis`, so `/reload` (hot module replacement) keeps running
 * children and their buffers alive instead of leaking or dropping them.
 */

import type {
  AgentToolResult,
  ExtensionAPI,
} from "@earendil-works/pi-coding-agent";
import { defineTool } from "@earendil-works/pi-coding-agent";
import {
  actionStart,
  actionStop,
  actionRestart,
  actionList,
  actionStatus,
  actionOutput,
  actionWait,
  actionInput,
} from "./src/actions.js";
import {
  WatchStartSchema,
  WatchStopSchema,
  WatchRestartSchema,
  WatchListSchema,
  WatchStatusSchema,
  WatchOutputSchema,
  WatchWaitSchema,
  WatchInputSchema,
  WatchStartOutputSchema,
  WatchStopOutputSchema,
  WatchRestartOutputSchema,
  WatchListOutputSchema,
  WatchStatusOutputSchema,
  WatchOutputOutputSchema,
  WatchWaitOutputSchema,
  WatchInputOutputSchema,
} from "./src/schemas.js";
import {
  formatLine,
  formatProcessSummary,
  formatProcessStatus,
  toLineJson,
  toProcessSummary,
} from "./src/format.js";
import {
  killAll,
  detachAllWaiters,
  type WatchProcess,
} from "./src/process.js";

// ─── Shared constants / helpers ──────────────────────────────────────────────

const WATCH_NAMESPACE = {
  name: "watch",
  description:
    "Long-running CLI watch-mode processes (build/test/lint watchers). Processes are addressed by id or name.",
} as const;

const READ_ONLY = { readOnlyHint: true, openWorldHint: true } as const;
const MUTATING = { readOnlyHint: false, openWorldHint: true } as const;
const DESTRUCTIVE = { readOnlyHint: false, destructiveHint: true } as const;

type Structured = AgentToolResult<unknown>["structuredContent"];

/** Model-facing text plus matching `structuredContent` for codemode scripts. */
const okResult = (
  text: string,
  structuredContent: unknown,
): AgentToolResult<unknown> => ({
  content: [{ type: "text", text }],
  details: {},
  structuredContent: structuredContent as Structured,
});

/** Failure that still carries `{ ok: false, error }` for codemode scripts. */
const failResult = (error: string): AgentToolResult<unknown> => ({
  content: [{ type: "text", text: `Error: ${error}` }],
  details: {},
  structuredContent: { ok: false, error } as Structured,
  isError: true,
});

// ─── Extension ────────────────────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
  // HMR: on `/reload`, keep the child processes running and only detach the
  // previous runtime's waiters. The global registry lets the next runtime adopt
  // them. On any other shutdown (quit, new/resume/fork), stop everything.
  pi.on("session_shutdown", async (event) => {
    if (event.reason === "reload") {
      detachAllWaiters();
      return;
    }
    await killAll();
  });

  // ─── Tools ─────────────────────────────────────────────────────────────────

  pi.registerTool(
    defineTool({
      name: "watch_start",
      label: "Watch Start",
      description:
        "Start a CLI watch-mode process and return its ID. The process runs in the background; use watch_output, watch_status, and watch_wait to monitor it.",
      promptSnippet:
        "Start a long-running CLI process (e.g. tsc --watch, jest --watch) and monitor its output",
      promptGuidelines: [
        "Use watch_start to launch build/test/lint watchers, then watch_wait to block until they finish a cycle.",
        "Use watch_list to see all running processes, watch_output to poll incremental output, watch_restart to hot-restart one, and watch_stop to terminate one.",
      ],
      parameters: WatchStartSchema,
      outputSchema: WatchStartOutputSchema,
      namespace: WATCH_NAMESPACE,
      annotations: MUTATING,
      executionMode: "sequential",
      async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
        const result = actionStart({
          command: params.command,
          args: params.args ?? [],
          cwd: params.cwd ?? ctx.cwd,
          name: params.name ?? undefined,
          bufferSize: params.bufferSize,
        });

        if (!result.ok) return failResult(result.error);

        const proc = result.value;
        return okResult(
          `Started process ${proc.id} (${proc.name ?? proc.command}). PID: ${proc.child?.pid ?? "n/a"}\nCommand: ${proc.command} ${proc.args.join(" ")}\nCWD: ${proc.cwd}`,
          { ok: true, process: toProcessSummary(proc) },
        );
      },
    }),
  );

  pi.registerTool(
    defineTool({
      name: "watch_stop",
      label: "Watch Stop",
      description: "Stop a running watch process by ID or name.",
      parameters: WatchStopSchema,
      outputSchema: WatchStopOutputSchema,
      namespace: WATCH_NAMESPACE,
      annotations: DESTRUCTIVE,
      executionMode: "sequential",
      async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
        const result = await actionStop(params.process);
        if (!result.ok) return failResult(result.error);

        const { process: proc, wasRunning } = result.value;
        return okResult(
          `Stopped process ${proc.id} (${proc.name ?? proc.command}).`,
          { ok: true, process: toProcessSummary(proc), was_running: wasRunning },
        );
      },
    }),
  );

  pi.registerTool(
    defineTool({
      name: "watch_restart",
      label: "Watch Restart",
      description:
        "Hot-restart a watch process: stop and start it again in place, preserving its ID, name, and buffered output. Use after editing a config the watcher reads, or when a watcher is wedged.",
      promptSnippet:
        "Hot-restart a watch process in place, keeping its id, name, and output history",
      promptGuidelines: [
        "Prefer watch_restart over a stop+start pair when you want to keep the process's id, name, and buffered history.",
      ],
      parameters: WatchRestartSchema,
      outputSchema: WatchRestartOutputSchema,
      namespace: WATCH_NAMESPACE,
      annotations: DESTRUCTIVE,
      executionMode: "sequential",
      async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
        const result = await actionRestart(params.process);
        if (!result.ok) return failResult(result.error);

        const proc = result.value;
        return okResult(
          `Restarted process ${proc.id} (${proc.name ?? proc.command}). PID: ${proc.child?.pid ?? "n/a"}`,
          { ok: true, process: toProcessSummary(proc) },
        );
      },
    }),
  );

  pi.registerTool(
    defineTool({
      name: "watch_list",
      label: "Watch List",
      description: "List all tracked watch processes and their status.",
      parameters: WatchListSchema,
      outputSchema: WatchListOutputSchema,
      namespace: WATCH_NAMESPACE,
      annotations: READ_ONLY,
      async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
        const list = actionList(params.includeCompleted !== false);
        const running = list.filter((p: WatchProcess) => !p.exited).length;
        const stopped = list.filter((p: WatchProcess) => p.exited).length;
        const structured = {
          ok: true,
          processes: list.map(toProcessSummary),
          running,
          stopped,
        };

        if (list.length === 0) {
          return okResult(
            "No watch processes running. Use watch_start to launch one.",
            structured,
          );
        }

        const suffix =
          stopped > 0
            ? ` (${running} running, ${stopped} stopped)`
            : ` (${running} running)`;

        return okResult(
          list.map(formatProcessSummary).join("\n") + "\n" + suffix,
          structured,
        );
      },
    }),
  );

  pi.registerTool(
    defineTool({
      name: "watch_status",
      label: "Watch Status",
      description: "Get detailed status of a specific watch process.",
      parameters: WatchStatusSchema,
      outputSchema: WatchStatusOutputSchema,
      namespace: WATCH_NAMESPACE,
      annotations: READ_ONLY,
      async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
        const result = actionStatus(params.process);
        if (!result.ok) return failResult(result.error);
        return okResult(formatProcessStatus(result.value), {
          ok: true,
          process: toProcessSummary(result.value),
        });
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
      outputSchema: WatchOutputOutputSchema,
      namespace: WATCH_NAMESPACE,
      annotations: READ_ONLY,
      async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
        const result = actionOutput({
          process: params.process,
          since_seq: params.since_seq,
          since_seconds_ago: params.since_seconds_ago,
          limit: params.limit,
          sources: params.sources,
        });
        if (!result.ok) return failResult(result.error);

        const { process: proc, lines, empty } = result.value;
        return okResult(
          empty ? "(no new output)" : lines.map(formatLine).join("\n"),
          {
            ok: true,
            process: toProcessSummary(proc),
            lines: lines.map(toLineJson),
            empty,
            latest_seq: proc.buffer.latestSeq(),
          },
        );
      },
    }),
  );

  pi.registerTool(
    defineTool({
      name: "watch_wait",
      label: "Watch Wait",
      description:
        "Block until new output arrives from a watch process, optionally waiting for a specific substring or regex match. Ideal for waiting for a build or test cycle to complete.",
      parameters: WatchWaitSchema,
      outputSchema: WatchWaitOutputSchema,
      namespace: WATCH_NAMESPACE,
      annotations: READ_ONLY,
      async execute(_toolCallId, params, signal, _onUpdate, _ctx) {
        const result = await actionWait({
          process: params.process,
          since_seq: params.since_seq,
          since_seconds_ago: params.since_seconds_ago,
          timeout_ms: params.timeout_ms,
          match: params.match,
          matchRegex: params.matchRegex,
          sources: params.sources,
          signal,
        });
        if (!result.ok) return failResult(result.error);

        const { process: proc, lines, empty, matched, timedOut } = result.value;
        return okResult(
          empty ? "(timeout — no new output)" : lines.map(formatLine).join("\n"),
          {
            ok: true,
            process: toProcessSummary(proc),
            lines: lines.map(toLineJson),
            empty,
            latest_seq: proc.buffer.latestSeq(),
            matched,
            timed_out: timedOut,
          },
        );
      },
    }),
  );

  pi.registerTool(
    defineTool({
      name: "watch_input",
      label: "Watch Input",
      description:
        "Send a line of text to a watch process's stdin (e.g. to answer interactive prompts).",
      parameters: WatchInputSchema,
      outputSchema: WatchInputOutputSchema,
      namespace: WATCH_NAMESPACE,
      annotations: MUTATING,
      executionMode: "sequential",
      async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
        const result = actionInput(params.process, params.text);
        if (!result.ok) return failResult(result.error);

        const proc = result.value;
        return okResult("Input sent.", {
          ok: true,
          process: toProcessSummary(proc),
          text: params.text,
        });
      },
    }),
  );
}