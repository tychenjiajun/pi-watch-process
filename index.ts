/**
 * watch — Pi extension to manage CLI watch-mode processes
 *
 * Start, monitor, and control long-running CLI processes (tsc --watch,
 * jest --watch, cargo watch, etc.) directly from pi's LLM tool calls.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { defineTool } from "@earendil-works/pi-coding-agent";
import {
  actionStart,
  actionStop,
  actionList,
  actionStatus,
  actionOutput,
  actionWait,
  actionInput,
} from "./src/actions.js";
import {
  WatchStartSchema,
  WatchStopSchema,
  WatchListSchema,
  WatchStatusSchema,
  WatchOutputSchema,
  WatchWaitSchema,
  WatchInputSchema,
} from "./src/schemas.js";
import { formatProcessSummary, formatProcessStatus } from "./src/format.js";
import { killAll, processes, type WatchProcess } from "./src/process.js";

// ─── Extension ────────────────────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
  pi.on("session_shutdown", async () => {
    await killAll();
  });

  // ─── Slash Commands ────────────────────────────────────────────────────────

  pi.registerCommand("watch-start", {
    description: "Start a CLI watch-mode process",
    handler: async (args, ctx) => {
      const parts = args.trim().split(/\s+/);
      if (parts.length === 0 || parts[0] === "") {
        ctx.ui.notify(
          "Usage: /watch-start <command> [args...] [--name <name>]",
          "error",
        );
        return;
      }

      // Parse --name flag
      let name: string | undefined;
      const nameIdx = parts.indexOf("--name");
      if (nameIdx >= 0 && nameIdx + 1 < parts.length) {
        name = parts[nameIdx + 1];
        parts.splice(nameIdx, 2);
      }

      const command = parts[0];
      const rest = parts.slice(1);

      const result = actionStart({ command, args: rest, cwd: ctx.cwd, name });

      if (!result.ok) {
        ctx.ui.notify(result.error, "error");
      } else {
        const proc = result.value;
        ctx.ui.notify(
          `Started ${proc.id} (${name ?? command}). PID: ${proc.child?.pid ?? "n/a"}`,
          "info",
        );
      }
    },
  });

  pi.registerCommand("watch-stop", {
    description: "Stop a watch process by ID or name",
    getArgumentCompletions: (prefix) => {
      const items = [...processes.values()]
        .filter((p) => !p.exited)
        .map((p) => ({
          value: p.id,
          label: p.name ? `${p.id} (${p.name})` : p.id,
        }));
      if (prefix) {
        return items.filter(
          (i) =>
            i.value.startsWith(prefix) ||
            i.label.toLowerCase().includes(prefix.toLowerCase()),
        );
      }
      return items.length > 0 ? items : null;
    },
    handler: async (args, ctx) => {
      const ref = args.trim();
      if (!ref) {
        ctx.ui.notify(
          "Usage: /watch-stop <process-id-or-name>",
          "error",
        );
        return;
      }
      const result = await actionStop(ref);
      if (!result.ok) {
        ctx.ui.notify(result.error, "error");
      } else {
        const proc = result.value;
        ctx.ui.notify(
          `Stopped ${proc.id} (${proc.name ?? proc.command})`,
          "info",
        );
      }
    },
  });

  pi.registerCommand("watch-list", {
    description: "List all running watch processes",
    handler: async (_args, ctx) => {
      const list = actionList(false);
      if (list.length === 0) {
        ctx.ui.notify("No watch processes running", "info");
        return;
      }
      const lines = list.map(formatProcessSummary);
      ctx.ui.setWidget("watch-list", lines, { placement: "belowEditor" });
      ctx.ui.notify(`${list.length} process(es) running`, "info");
    },
  });

  pi.registerCommand("watch-status", {
    description: "Show detailed status of a watch process",
    getArgumentCompletions: (prefix) => {
      const items = [...processes.values()]
        .filter((p) => !p.exited)
        .map((p) => ({
          value: p.id,
          label: p.name ? `${p.id} (${p.name})` : p.id,
        }));
      if (prefix) {
        return items.filter(
          (i) =>
            i.value.startsWith(prefix) ||
            i.label.toLowerCase().includes(prefix.toLowerCase()),
        );
      }
      return items.length > 0 ? items : null;
    },
    handler: async (args, ctx) => {
      const ref = args.trim();
      if (!ref) {
        ctx.ui.notify(
          "Usage: /watch-status <process-id-or-name>",
          "error",
        );
        return;
      }
      const result = actionStatus(ref);
      if (!result.ok) {
        ctx.ui.notify(result.error, "error");
      } else {
        ctx.ui.notify(formatProcessStatus(result.value), "info");
      }
    },
  });

  pi.registerCommand("watch-output", {
    description: "Show recent output from a watch process",
    getArgumentCompletions: (prefix) => {
      const items = [...processes.values()]
        .filter((p) => !p.exited)
        .map((p) => ({
          value: p.id,
          label: p.name ? `${p.id} (${p.name})` : p.id,
        }));
      if (prefix) {
        return items.filter(
          (i) =>
            i.value.startsWith(prefix) ||
            i.label.toLowerCase().includes(prefix.toLowerCase()),
        );
      }
      return items.length > 0 ? items : null;
    },
    handler: async (args, ctx) => {
      const parts = args.trim().split(/\s+/);
      if (parts.length === 0 || parts[0] === "") {
        ctx.ui.notify(
          "Usage: /watch-output <process> [--since <seq|seconds>] [--limit <n>]",
          "error",
        );
        return;
      }

      const ref = parts[0];

      let sinceSeq: number | undefined;
      let sinceSecondsAgo: number | undefined;
      let limit = 50;

      for (let i = 1; i < parts.length; i++) {
        if (parts[i] === "--since" && i + 1 < parts.length) {
          const val = parts[i + 1];
          if (val.endsWith("s")) {
            sinceSecondsAgo = parseInt(val.slice(0, -1), 10);
          } else {
            sinceSeq = parseInt(val, 10);
          }
          i++;
        } else if (parts[i] === "--limit" && i + 1 < parts.length) {
          limit = parseInt(parts[i + 1], 10);
          i++;
        }
      }

      const result = actionOutput({
        process: ref,
        since_seq: sinceSeq,
        since_seconds_ago: sinceSecondsAgo,
        limit,
      });

      if (!result.ok) {
        ctx.ui.notify(result.error, "error");
      } else if (result.value.empty) {
        ctx.ui.notify("(no output)", "info");
      } else {
        ctx.ui.setWidget(`watch-output-${result.value.process.id}`, [result.value.lines], {
          placement: "belowEditor",
        });
      }
    },
  });

  pi.registerCommand("watch-wait", {
    description:
      "Wait for new output from a watch process (optionally matching a substring)",
    getArgumentCompletions: (prefix) => {
      const items = [...processes.values()]
        .filter((p) => !p.exited)
        .map((p) => ({
          value: p.id,
          label: p.name ? `${p.id} (${p.name})` : p.id,
        }));
      if (prefix) {
        return items.filter(
          (i) =>
            i.value.startsWith(prefix) ||
            i.label.toLowerCase().includes(prefix.toLowerCase()),
        );
      }
      return items.length > 0 ? items : null;
    },
    handler: async (args, ctx) => {
      const parts = args.trim().split(/\s+/);
      if (parts.length === 0 || parts[0] === "") {
        ctx.ui.notify(
          "Usage: /watch-wait <process> [--match <text>] [--timeout <ms>]",
          "error",
        );
        return;
      }

      const ref = parts[0];

      let match: string | undefined;
      let timeout = 15000;

      for (let i = 1; i < parts.length; i++) {
        if (parts[i] === "--match" && i + 1 < parts.length) {
          match = parts[i + 1];
          i++;
        } else if (parts[i] === "--timeout" && i + 1 < parts.length) {
          timeout = parseInt(parts[i + 1], 10);
          i++;
        }
      }

      ctx.ui.notify(
        `Waiting for output${match ? ` matching "${match}"` : ""}...`,
        "info",
      );

      const result = await actionWait({
        process: ref,
        timeout_ms: timeout,
        match,
      });

      if (!result.ok) {
        ctx.ui.notify(result.error, "error");
      } else {
        ctx.ui.setWidget(
          `watch-wait-${result.value.process.id}`,
          [result.value.lines],
          { placement: "belowEditor" },
        );
      }
    },
  });

  pi.registerCommand("watch-input", {
    description: "Send text to a watch process's stdin",
    getArgumentCompletions: (prefix) => {
      const items = [...processes.values()]
        .filter((p) => !p.exited)
        .map((p) => ({
          value: p.id,
          label: p.name ? `${p.id} (${p.name})` : p.id,
        }));
      if (prefix) {
        return items.filter(
          (i) =>
            i.value.startsWith(prefix) ||
            i.label.toLowerCase().includes(prefix.toLowerCase()),
        );
      }
      return items.length > 0 ? items : null;
    },
    handler: async (args, ctx) => {
      const parts = args.trim().split(/\s+/);
      if (parts.length < 2 || parts[0] === "") {
        ctx.ui.notify("Usage: /watch-input <process> <text>", "error");
        return;
      }

      const ref = parts[0];
      const text = parts.slice(1).join(" ");

      const result = actionInput(ref, text);
      if (!result.ok) {
        ctx.ui.notify(result.error, "error");
      } else {
        ctx.ui.notify(`Sent to ${result.value.id}: ${text}`, "info");
      }
    },
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
        "Use watch_list to see all running processes, watch_output to poll incremental output, and watch_stop to terminate one.",
      ],
      parameters: WatchStartSchema,
      async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
        const result = actionStart({
          command: params.command,
          args: params.args ?? [],
          cwd: params.cwd ?? ctx.cwd,
          name: params.name ?? undefined,
          bufferSize: params.bufferSize,
        });

        if (!result.ok) {
          return {
            content: [{ type: "text" as const, text: `Error: ${result.error}` }],
            details: {},
          };
        }

        const proc = result.value;
        return {
          content: [
            {
              type: "text" as const,
              text: `Started process ${proc.id} (${proc.name ?? proc.command}). PID: ${proc.child?.pid ?? "n/a"}\nCommand: ${proc.command} ${proc.args.join(" ")}\nCWD: ${proc.cwd}`,
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
        const result = await actionStop(params.process);
        if (!result.ok) {
          return {
            content: [{ type: "text" as const, text: `Error: ${result.error}` }],
            details: {},
          };
        }
        const proc = result.value;
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
      async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
        const list = actionList(params.includeCompleted !== false);

        if (list.length === 0) {
          return {
            content: [
              {
                type: "text" as const,
                text: "No watch processes running. Use watch_start to launch one.",
              },
            ],
            details: {},
          };
        }

        const running = list.filter((p: WatchProcess) => !p.exited).length;
        const stopped = list.filter((p: WatchProcess) => p.exited).length;
        const suffix =
          stopped > 0
            ? ` (${running} running, ${stopped} stopped)`
            : ` (${running} running)`;

        return {
          content: [
            {
              type: "text" as const,
              text:
                list.map(formatProcessSummary).join("\n") + "\n" + suffix,
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
        const result = actionStatus(params.process);
        if (!result.ok) {
          return {
            content: [{ type: "text" as const, text: `Error: ${result.error}` }],
            details: {},
          };
        }
        return {
          content: [
            {
              type: "text" as const,
              text: formatProcessStatus(result.value),
            },
          ],
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
        const result = actionOutput({
          process: params.process,
          since_seq: params.since_seq,
          since_seconds_ago: params.since_seconds_ago,
          limit: params.limit,
          sources: params.sources,
        });

        if (!result.ok) {
          return {
            content: [{ type: "text" as const, text: `Error: ${result.error}` }],
            details: {},
          };
        }
        return {
          content: [{ type: "text" as const, text: result.value.lines }],
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

        if (!result.ok) {
          return {
            content: [{ type: "text" as const, text: `Error: ${result.error}` }],
            details: {},
          };
        }
        return {
          content: [{ type: "text" as const, text: result.value.lines }],
          details: {},
        };
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
      async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
        const result = actionInput(params.process, params.text);
        if (!result.ok) {
          return {
            content: [{ type: "text" as const, text: `Error: ${result.error}` }],
            details: {},
          };
        }
        return {
          content: [{ type: "text" as const, text: "Input sent." }],
          details: {},
        };
      },
    }),
  );
}
