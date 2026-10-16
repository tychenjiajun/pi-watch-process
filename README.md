# pi-watch-process

Pi extension for managing CLI watch-mode processes. Start, monitor, hot-restart, and control long-running commands like `tsc --watch`, `jest --watch`, or `cargo watch` directly from the LLM — or from a [codemode](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/codemode.md) script.

## Installation

Place in an auto-discovery location or use `--extension`:

```bash
# Quick test
pi -e /path/to/pi-watch-process/index.ts

# Global install
ln -s ~/projects/pi-watch-process ~/.pi/agent/extensions/watch-process

# Project-local
mkdir -p .pi/extensions
ln -s ~/projects/pi-watch-process .pi/extensions/watch-process
```

Or configure via `settings.json`:

```json
{
  "extensions": ["/path/to/pi-watch-process"]
}
```

## Tools

Once loaded, 8 tools are available to the LLM and to codemode scripts.

| Tool | Description | Key Parameters |
|------|-------------|----------------|
| `watch_start` | Start a process | `{command, args[], cwd?, name?, bufferSize?}` |
| `watch_stop` | Stop a process by ID or name | `{process}` |
| `watch_restart` | Hot-restart in place (keeps ID, name, history) | `{process}` |
| `watch_list` | List all tracked processes | `{includeCompleted?}` |
| `watch_status` | Detailed status of one process | `{process}` |
| `watch_output` | Get recent output | `{process, since_seq?, since_seconds_ago?, limit?, sources?}` |
| `watch_wait` | Block until new output/match | `{process, since_seq?, since_seconds_ago?, timeout_ms?, match?, matchRegex?, sources?}` |
| `watch_input` | Send text to stdin | `{process, text}` |

### Example workflow

**1. Start a TypeScript watcher:**

```jsonc
{ "name": "watch_start", "arguments": { "command": "tsc", "args": ["--watch"], "cwd": "/path/to/project", "name": "tsc" } }
// → Started process proc_1 (tsc). PID: 12345
```

**2. Wait for compilation to finish:**

```jsonc
{ "name": "watch_wait", "arguments": { "process": "proc_1", "match": "Found X error(s)", "timeout_ms": 30000 } }
```

**3. Poll incremental output:**

```jsonc
{ "name": "watch_output", "arguments": { "process": "tsc", "since_seq": 42, "limit": 50 } }
```

**4. Hot-restart after editing a watched config:**

```jsonc
{ "name": "watch_restart", "arguments": { "process": "tsc" } }
```

## Codemode

Every tool declares an `outputSchema` and returns `structuredContent`, so codemode scripts receive data instead of parsing text. Success results are `{ ok: true, ... }`; failures come back with `isError: true` and `{ ok: false, error }`, so scripts branch without `try/catch`.

```js
// Run a build, wait for it to settle, then inspect structured output — one script.
const started = tools.watch_start({ command: "tsc", args: ["--watch"], name: "tsc" });
if (!started.ok) throw new Error(started.error);

const wait = await tools.watch_wait({ process: started.process.id, match: "Found 0 errors", timeout_ms: 30000 });
const errors = tools.watch_output({ process: started.process.id, sources: ["stderr"] });

return {
  pid: started.process.pid,
  matched: wait.matched,
  timed_out: wait.timed_out,
  stderr: errors.lines.map((l) => l.text),
};
```

`watch_wait` is a real pending tool call, so it works inside the timer-less codemode sandbox. Because results are structured, scripts can fan out across several watchers and filter output before the model ever sees it.

## Hot module replacement (HMR)

The extension is built to survive `/reload`:

- The process registry lives on `globalThis`, not in module scope, so a reloaded runtime **adopts the still-running children** and their ring buffers instead of leaking or dropping them.
- The `data` / `close` handlers attached by the previous runtime keep streaming into the same buffers, so no output is lost across a reload.
- On `session_shutdown` with reason `reload`, pending `watch_wait` listeners are detached but the children are **left running**. On every other shutdown reason (`quit`, `new`, `resume`, `fork`) all children are killed.
- `watch_restart` is the in-process HMR primitive: stop and start a watcher in place while preserving its ID, name, and buffered history.

## Features

- **Multiple processes**: run several watchers simultaneously (e.g. tsc + jest + cargo watch)
- **Flexible identification**: reference processes by auto-generated ID (`proc_1`) or human-readable name (`tsc`)
- **Ring buffer**: 500-line rolling buffer with sequence numbers and timestamps
- **Flexible queries**: `since_seq` for polling, or `since_seconds_ago` for time-based queries
- **Blocking wait**: `watch_wait` blocks with substring or regex matching (ideal for "wait for build to finish")
- **Structured results**: every tool has an `outputSchema` for codemode; the model still gets readable text
- **HMR-safe**: reloads adopt running processes; `watch_restart` hot-restarts in place
- **Stdin support**: send input to interactive prompts via `watch_input`
- **No persistence**: all processes are killed on real session shutdown (fresh start each time)
- **Abort-safe**: `watch_wait` honors the agent abort signal (Esc cancels the wait)
- **ANSI stripping**: output is automatically cleaned of terminal escape codes
- **Source tagging**: each line is tagged as `stdout`, `stderr`, or `system`

## How it relates to LSP

This extension is complementary to a language server, not a replacement for it. See [docs/vs-lsp.md](./docs/vs-lsp.md) for the full comparison — the short version is that LSP wins for precise, structured language diagnostics, while watch-process wins for anything that runs as a CLI (builds, tests, linters, dev servers) and for anything interactive.

## Technical details

- No build required — TypeScript compiled on-the-fly via jiti
- Follows patterns from `pi-headless-subagent` (state management, cleanup on shutdown)
- Peer dependencies: `@earendil-works/pi-coding-agent`, `@sinclair/typebox`
- Pure Node.js implementation using `child_process.spawn` and `EventEmitter`

## License

MIT