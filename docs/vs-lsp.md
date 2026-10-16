# pi-watch-process vs. LSP

A language server (LSP) and this extension both surface build/lint errors to a
coding agent, so the question "don't we already have LSP for this?" is fair.
They overlap on exactly one job — diagnostics — and even there they solve it
differently. Everywhere else they are orthogonal.

## TL;DR

| Job | LSP | pi-watch-process |
|-----|-----|------------------|
| Type/lint errors | ✅ precise, ranged, incremental | ⚠️ only if a CLI watcher emits them, as text |
| Hover / go-to-def / references / rename / symbols | ✅ | ❌ |
| Run tests, bundlers, dev servers, migrations, docker | ❌ | ✅ |
| Any language without an LSP server installed | ❌ | ✅ |
| Interactive prompts (stdin), REPLs | ❌ | ✅ |
| "Wait until the build finishes / print matches X" | ❌ | ✅ |
| Zero setup in pi | ❌ (needs an LSP client/bridge) | ✅ (one extension) |
| Structured data for `codemode` | ✅ (if bridged) | ✅ (`outputSchema`) |

**Verdict:** use LSP for language semantics, use watch-process for process
execution. They compose; they do not replace each other. watch-process should
*not* try to become an LSP.

## Where LSP wins outright

- **Structure.** An LSP diagnostic is `{ range, severity, code, message,
  source, relatedInformation, data }`. `tsc --watch` prints a human string the
  model has to parse (`file.ts(12,5): error TS2322: ...`). LSP is machine-first;
  watcher output is human-first.
- **Incrementality and latency.** LSP pushes `textDocument/publishDiagnostics`
  after each edit, scoped to changed files. `tsc --watch` re-typechecks a
  program graph. LSP is cheaper and faster to a first error.
- **Navigation.** Hover, definition, references, rename, workspace symbols,
  code actions — there is no CLI watcher equivalent. A watcher cannot answer
  "where is this used?".
- **Token efficiency for an LLM.** A filtered, ranged diagnostic list is far
  smaller and more actionable than a rolling wall of compiler output.

So for "fix the TypeScript errors in this repo", a bridged LSP is the better
tool. watch-process is the fallback, not the first choice.

## Where watch-process wins outright

- **Language- and tool-agnostic.** It runs *any* CLI: `jest`, `vitest`,
  `cargo watch`, `go test`, `pytest`, `webpack`, `vite`, `docker compose`,
  `terraform plan`, a migration runner, a custom script. LSP covers one
  language at a time and requires a server per language.
- **Whole pipelines, not just semantics.** LSP does not run your tests, bundle
  your app, or start your dev server. That is where most of an agent's build
  loop actually lives.
- **Long-running state.** LSP models documents. watch-process models
  *processes* with lifetime, PID, uptime, buffered history, and stdin.
- **Interactivity.** `watch_input` answers prompts (jest's `p`/`q`, `Continue?
  [y/N]`, REPLs). LSP has no stdin channel to a build.
- **Pattern-based synchronization.** `watch_wait({ match })` / `matchRegex`
  turns "block until the build settles / the server is ready / the suite
  finishes" into one call. LSP has no notion of a run cycle.
- **Setup cost in pi today.** pi does not ship an LSP client; LSP needs an MCP
  server or a bridge extension. watch-process is one extension and works
  immediately, in any repo, for any tool.

## How they compete in an agentic loop

1. **Diagnostics (LSP favored).** If an LSP bridge is available, prefer it for
   type/lint errors and all refactoring. It is more precise, incremental, and
   token-efficient than parsing watcher text.
2. **Execution and verification (watch-process favored).** Run the test suite,
   start the dev server, watch the bundler, tail the logs, answer prompts.
   Nothing about LSP helps here.
3. **Coexistence.** The natural architecture is: LSP for *semantics*, this
   extension for *execution*. An agent can start `tsc --watch` (or `vite`) with
   watch-process, then use LSP to navigate and fix what it reports.

## The one place the gap is closable

watch-process could narrow the diagnostics gap without pretending to be an LSP:
an optional, opt-in **diagnostic adapter** that recognizes well-known watcher
output (`tsc`, `eslint`, `jest`, `cargo`) and emits structured diagnostics
(file, line, column, severity, code, message) through `structuredContent`.
Codemode scripts could then present structured errors even without an LSP.
The design constraint is to keep it opt-in and non-lossy: unknown tools must
still get raw lines, because the extension's value is that it runs *anything*.

That is an enhancement, not a strategy. The strategy stays: LSP owns language
understanding; watch-process owns process execution.