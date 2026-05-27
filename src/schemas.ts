import { Type } from "@sinclair/typebox";

// ─── Shared fragments ────────────────────────────────────────────────────────

export const SinceSeq = Type.Optional(
  Type.Number({ description: "Only return lines with seq > this value" }),
);

export const SinceSecondsAgo = Type.Optional(
  Type.Number({
    description:
      "Only return lines from the last N seconds. Mutually exclusive with since_seq.",
  }),
);

export const Limit = Type.Optional(
  Type.Number({ description: "Max lines to return (default 50, max 200)" }),
);

// ─── Tool schemas ────────────────────────────────────────────────────────────

export const WatchStartSchema = Type.Object({
  command: Type.String({
    description: "Command to run (e.g. tsc, jest, cargo)",
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
      description: "Ring buffer capacity in lines (default 500). Increase for large test suites with lots of output.",
    }),
  ),
});

export const WatchStopSchema = Type.Object({
  process: Type.String({ description: "Process ID or name to stop" }),
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
    Type.Array(Type.Union([Type.Literal("stdout"), Type.Literal("stderr"), Type.Literal("system")]), {
      description: "Filter by source. Omit or pass all three to see everything.",
    }),
  ),
});

export const WatchWaitSchema = Type.Object({
  process: Type.String({ description: "Process ID or name" }),
  since_seq: SinceSeq,
  since_seconds_ago: SinceSecondsAgo,
  timeout_ms: Type.Optional(
    Type.Number({ description: "Max wait in ms (default 15000, capped at 60000)" }),
  ),
  match: Type.Optional(
    Type.String({
      description:
        "Substring to wait for (case-insensitive). Returns as soon as a matching line appears.",
    }),
  ),
  matchRegex: Type.Optional(
    Type.String({
      description:
        "Regex pattern to wait for (case-insensitive). Use for anchored matches like ^Test Files. Mutually orthogonal with match — both can be combined.",
    }),
  ),
  sources: Type.Optional(
    Type.Array(Type.Union([Type.Literal("stdout"), Type.Literal("stderr"), Type.Literal("system")]), {
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
