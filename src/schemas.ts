import { Type, type TSchema } from "@sinclair/typebox";

// ─── Shared fragments ────────────────────────────────────────────────────────

export const SinceSeq = Type.Optional(
  Type.Number({ description: "Only return lines with seq > this value" }),
);

export const SinceSecondsAgo = Type.Optional(
  Type.Number({
    description:
      "Only return lines from the last N seconds. In watch_wait this overrides since_seq; in watch_output both filters are combined (AND).",
  }),
);

export const Limit = Type.Optional(
  Type.Number({ description: "Max lines to return (default 50, max 200)" }),
);

const SourceSchema = Type.Union([
  Type.Literal("stdout"),
  Type.Literal("stderr"),
  Type.Literal("system"),
]);

// ─── Tool input schemas ──────────────────────────────────────────────────────

export const WatchStartSchema = Type.Object({
  command: Type.String({
    description:
      "Command to run (e.g. tsc, jest, cargo, npm). Resolved from node_modules/.bin then PATH.",
  }),
  args: Type.Optional(
    Type.Array(Type.String(), {
      description: "Arguments to pass (e.g. [--watch, --no-coverage])",
    }),
  ),
  cwd: Type.Optional(
    Type.String({
      description: "Working directory. Defaults to current project cwd.",
    }),
  ),
  name: Type.Optional(
    Type.String({
      description: "Human-readable name (e.g. tsc, jest). Must be unique.",
    }),
  ),
  bufferSize: Type.Optional(
    Type.Number({
      default: 500,
      description:
        "Ring buffer capacity in lines (default 500). Increase for large test suites with lots of output.",
    }),
  ),
});

export const WatchStopSchema = Type.Object({
  process: Type.String({ description: "Process ID or name to stop" }),
});

export const WatchRestartSchema = Type.Object({
  process: Type.String({
    description:
      "Process ID or name to hot-restart (stop then start again in place). The id and name are preserved.",
  }),
});

export const WatchListSchema = Type.Object({
  includeCompleted: Type.Optional(
    Type.Boolean({
      default: true,
      description: "Include completed, errored, and killed processes",
    }),
  ),
});

export const WatchStatusSchema = Type.Object({
  process: Type.String({ description: "Process ID or name" }),
});

export const WatchOutputSchema = Type.Object({
  process: Type.String({ description: "Process ID or name" }),
  since_seq: SinceSeq,
  since_seconds_ago: SinceSecondsAgo,
  limit: Limit,
  sources: Type.Optional(
    Type.Array(SourceSchema, {
      description: "Filter by source. Omit or pass all three to see everything.",
    }),
  ),
});

export const WatchWaitSchema = Type.Object({
  process: Type.String({ description: "Process ID or name" }),
  since_seq: SinceSeq,
  since_seconds_ago: SinceSecondsAgo,
  timeout_ms: Type.Optional(
    Type.Number({
      description: "Max wait in ms (default 15000, capped at 60000)",
    }),
  ),
  match: Type.Optional(
    Type.String({
      description:
        "Substring to wait for (case-insensitive). Returns as soon as a matching line appears.",
    }),
  ),
  matchRegex: Type.Optional(
    Type.String({
      minLength: 1,
      description:
        "Regex pattern to wait for (case-insensitive). Use for anchored matches like ^Test Files. Can be combined with match. Invalid regex patterns return an error.",
    }),
  ),
  sources: Type.Optional(
    Type.Array(SourceSchema, {
      description: "Filter by source. Omit or pass all three to see everything.",
    }),
  ),
});

export const WatchInputSchema = Type.Object({
  process: Type.String({ description: "Process ID or name" }),
  text: Type.String({
    description: "Text to send (newline appended automatically)",
  }),
});

// ─── Tool output schemas (structuredContent for codemode) ────────────────────
//
// Every tool declares an `outputSchema`, so codemode scripts receive
// `structuredContent` instead of parsing the model-facing text. Success results
// carry `{ ok: true, ... }`; failures carry `{ ok: false, error }` alongside
// `isError: true`, so scripts can branch without try/catch.

export const ProcessSummarySchema = Type.Object({
  id: Type.String(),
  name: Type.Union([Type.String(), Type.Null()]),
  command: Type.String(),
  args: Type.Array(Type.String()),
  cwd: Type.String(),
  pid: Type.Union([Type.Number(), Type.Null()]),
  running: Type.Boolean(),
  uptime_sec: Type.Number(),
  buffered_lines: Type.Number(),
  latest_seq: Type.Number(),
  latest_ts: Type.Union([Type.Number(), Type.Null()]),
});

export const BufferedLineSchema = Type.Object({
  seq: Type.Number(),
  source: SourceSchema,
  text: Type.String(),
  ts: Type.Number(),
});

export const ProcessListSchema = Type.Object({
  processes: Type.Array(ProcessSummarySchema),
  running: Type.Number(),
  stopped: Type.Number(),
});

export const LineSliceSchema = Type.Object({
  process: ProcessSummarySchema,
  lines: Type.Array(BufferedLineSchema),
  empty: Type.Boolean(),
  latest_seq: Type.Number(),
});

const ErrorOutputSchema = Type.Object({
  ok: Type.Literal(false),
  error: Type.String(),
});

const ok = <T extends TSchema>(fields: T) =>
  Type.Union([
    Type.Intersect([Type.Object({ ok: Type.Literal(true) }), fields]),
    ErrorOutputSchema,
  ]);

export const WatchStartOutputSchema = ok(
  Type.Object({ process: ProcessSummarySchema }),
);
export const WatchStopOutputSchema = ok(
  Type.Object({ process: ProcessSummarySchema, was_running: Type.Boolean() }),
);
export const WatchRestartOutputSchema = ok(
  Type.Object({ process: ProcessSummarySchema }),
);
export const WatchListOutputSchema = ok(ProcessListSchema);
export const WatchStatusOutputSchema = ok(
  Type.Object({ process: ProcessSummarySchema }),
);
export const WatchOutputOutputSchema = ok(LineSliceSchema);
export const WatchWaitOutputSchema = ok(
  Type.Object({
    process: ProcessSummarySchema,
    lines: Type.Array(BufferedLineSchema),
    empty: Type.Boolean(),
    latest_seq: Type.Number(),
    matched: Type.Boolean(),
    timed_out: Type.Boolean(),
  }),
);
export const WatchInputOutputSchema = ok(
  Type.Object({ process: ProcessSummarySchema, text: Type.String() }),
);