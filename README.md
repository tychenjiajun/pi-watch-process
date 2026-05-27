# pi-watch-process

Pi extension for managing CLI watch-mode processes. Start, monitor, and control long-running commands like `tsc --watch`, `jest --watch`, or `cargo watch` directly from the LLM.

## Installation

Place in auto-discovery location or use `--extension`:

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

## Usage

Once loaded, 7 tools are available to the LLM:

| Tool | Description | Key Parameters |
|------|-------------|----------------|
| `watch_start` | Start a process | `{command, args[], cwd?, name?}` |
| `watch_stop` | Stop a process by ID or name | `{process}` |
| `watch_list` | List all running processes | — |
| `watch_status` | Get detailed status of one process | `{process}` |
| `watch_output` | Get recent output | `{process, since_seq?, since_seconds_ago?, limit?}` |
| `watch_wait` | Block until new output/match | `{process, since_seq?, since_seconds_ago?, timeout_ms?, match?}` |
| `watch_input` | Send text to stdin | `{process, text}` |

### Example Workflow

**1. Start a TypeScript watcher:**

```typescript
{
  "name": "watch_start",
  "arguments": {
    "command": "tsc",
    "args": ["--watch"],
    "cwd": "/path/to/project",
    "name": "tsc"
  }
}
// → Started process proc_1 (tsc). PID: 12345
```

**2. Wait for compilation to finish:**

```typescript
{
  "name": "watch_wait",
  "arguments": {
    "process": "proc_1",
    "match": "Found X error(s)",
    "timeout_ms": 30000
  }
}
```

**3. Get incremental output (polling):**

```typescript
{
  "name": "watch_output",
  "arguments": {
    "process": "tsc",
    "since_seq": 42,
    "limit": 50
  }
}
```

**4. Get output from the last 60 seconds:**

```typescript
{
  "name": "watch_output",
  "arguments": {
    "process": "proc_1",
    "since_seconds_ago": 60
  }
}
```

**5. View all processes:**

```typescript
{
  "name": "watch_list"
}
```

## Features

- **Multiple processes**: Run several watchers simultaneously (e.g., tsc + jest + cargo watch)
- **Flexible identification**: Reference processes by auto-generated ID (`proc_1`) or human-readable name (`tsc`)
- **Ring buffer**: 500-line rolling buffer with sequence numbers and timestamps
- **Flexible queries**: Use `since_seq` for polling or `since_seconds_ago` for time-based queries
- **Blocking wait**: `watch_wait` blocks with optional substring matching (ideal for "wait for build to finish")
- **Stdin support**: Send input to interactive prompts via `watch_input`
- **No persistence**: All processes are killed on session shutdown (fresh start each time)
- **Abort-safe**: `watch_wait` honors the agent abort signal (Esc cancels the wait)
- **ANSI stripping**: Output is automatically cleaned of terminal escape codes
- **Source tagging**: Each line is tagged as `stdout`, `stderr`, or `system`

## Technical Details

- No build required — TypeScript compiled on-the-fly via jiti
- Follows patterns from `pi-headless-subagent` (state management, cleanup on shutdown)
- Peer dependencies: `@earendil-works/pi-coding-agent`, `@sinclair/typebox`
- Pure Node.js implementation using `child_process.spawn` and `EventEmitter`

## License

MIT
