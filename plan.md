# Watch MCP → Pi Extension Plan

## Architecture
Pure pi extension, no MCP server, no external dependencies beyond pi-provided packages.

## Tool Roster (7 tools)
| Tool | Purpose | Key Params |
|------|---------|------------|
| `watch_start` | Start a process, returns id | `command`, `args[]`, optional `cwd`, optional `name` |
| `watch_stop` | Stop a process by id or name | `process` |
| `watch_list` | List all running/completed processes | — |
| `watch_status` | Status of one process | `process` |
| `watch_output` | Get output | `process`, optional `since_seq`, optional `since_seconds_ago`, optional `limit` |
| `watch_wait` | Block until new output/match | `process`, optional `since_seq`, optional `since_seconds_ago`, optional `timeout_ms`, optional `match` |
| `watch_input` | Send stdin text | `process`, `text` |

## Process Identification
- Auto-generated IDs (`proc_1` etc) + optional human `name`
- `process` param on tools accepts either ID or name
- Duplicate names → error

## Ring Buffer
- Full implementation: seq numbers, timestamps, EventEmitter bus
- `since_seq` and `since_seconds_ago` supported on `watch_output` and `watch_wait`
- MAX_LINES = 500, ANSI stripping, source tagging (stdout/stderr/system)

## State Management
- No persistence
- `session_shutdown` kills all processes, fresh start on `session_start`
- Follow pi-headless-subagent patterns: Map-based state, defineTool

## Rendering
- No custom TUI rendering, plain text results, default pi rendering

## File Structure
- Single `index.ts` + `package.json` (with `pi.extensions`) + `tsconfig.json`
- Stays in `~/projects/watch-mcp/`, not linked to `~/.pi`
- Old `index.js` (standalone MCP server) has been removed

## Package Metadata
- Follow pi-headless-subagent conventions
- `peerDependencies` on `@earendil-works/pi-coding-agent`, `@sinclair/typebox`
- `devDependencies` for type checking
- `pi.extensions: ["./index.ts"]`