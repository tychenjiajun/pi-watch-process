# Watch MCP → Pi Extension Plan

## Architecture
Pure pi extension, no MCP server, no external runtime dependencies beyond
pi-provided packages. TypeScript is loaded on the fly by jiti; `tsc` is only
used for type checking and the deterministic smoke test.

## Tool Roster (8 tools)
| Tool | Purpose | Key Params |
|------|---------|------------|
| `watch_start` | Start a process, returns id | `command`, `args[]`, optional `cwd`, optional `name`, optional `bufferSize` |
| `watch_stop` | Stop a process by id or name | `process` |
| `watch_restart` | Hot-restart in place (keeps id/name/history) | `process` |
| `watch_list` | List all running/completed processes | `includeCompleted?` |
| `watch_status` | Status of one process | `process` |
| `watch_output` | Get output | `process`, optional `since_seq`, optional `since_seconds_ago`, optional `limit`, optional `sources` |
| `watch_wait` | Block until new output/match | `process`, optional `since_seq`, optional `since_seconds_ago`, optional `timeout_ms`, optional `match`/`matchRegex`, optional `sources` |
| `watch_input` | Send stdin text | `process`, `text` |

No slash commands: tools are the single interface, for the model and for
codemode scripts.

## Process Identification
- Auto-generated IDs (`proc_1` etc) + optional human `name`
- `process` param on tools accepts either ID or name
- Duplicate names → error

## Ring Buffer
- Full implementation: seq numbers, timestamps, EventEmitter bus
- `since_seq` and `since_seconds_ago` supported on `watch_output` and `watch_wait`
- `waitForLine` returns `{ lines, matched, timedOut }`
- MAX_LINES = 500, ANSI stripping, source tagging (stdout/stderr/system)

## Codemode compatibility
- Every tool declares an `outputSchema` (TypeBox) and returns `structuredContent`
- Success: `{ ok: true, ... }`; failure: `{ ok: false, error }` with `isError: true`
- `watch_wait` is a pending tool call, so it works in the timer-less sandbox
- read-only tools carry `readOnlyHint`; mutating tools run `executionMode: "sequential"`

## Hot module replacement
- Registry lives on `globalThis` under `Symbol.for("pi-watch-process.registry.v1")`
- `/reload` (`session_shutdown` reason `reload`) detaches waiters but keeps children;
  the next runtime adopts the same processes and buffers
- Other shutdown reasons (`quit`/`new`/`resume`/`fork`) kill everything
- `detachAllWaiters()` clears buffers' event listeners without touching data
- `watch_restart` is the in-place hot-restart primitive

## State Management
- No persistence across pi processes
- `session_shutdown` kills all processes except on `reload`
- Follows pi-headless-subagent patterns: Map-based state, defineTool

## Rendering
- No custom TUI rendering, plain text for the model
- Structured `structuredContent` for programmatic callers

## File Structure
- `index.ts` — extension entry: lifecycle + tool registration
- `src/` — actions, process registry, ring buffer, schemas, formatting
- `test/smoke.mjs` — deterministic action-layer + HMR smoke test
- `docs/vs-lsp.md` — relationship to language servers
- `package.json` with `pi.extensions`, `tsconfig.json`

## Package Metadata
- `peerDependencies` on `@earendil-works/pi-coding-agent`, `@sinclair/typebox`
- `devDependencies` for type checking and testing
- `pi.extensions: ["./index.ts"]`