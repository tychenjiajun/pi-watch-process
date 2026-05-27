# pi-watch

Pi extension to manage CLI watch-mode processes (tsc --watch, jest --watch, etc.).

## Install

Place in `~/.pi/agent/extensions/` or `.pi/extensions/`, or use `--extension`:

```bash
# Quick test
pi -e /path/to/watch-mcp/index.ts

# Global install
ln -s ~/projects/watch-mcp ~/.pi/agent/extensions/watch

# Project-local
mkdir -p .pi/extensions
ln -s ~/projects/watch-mcp .pi/extensions/watch
```

Or as a pi package in `settings.json`:

```json
{
  "extensions": ["/path/to/watch-mcp"]
}
```

## Usage

Once loaded, the extension registers 7 tools that the LLM can use to manage long-running CLI processes.

### Tools

| Tool | Description |
|------|-------------|
| `watch_start` | Start a process with `{command, args[], cwd?, name?}` |
| `watch_stop` | Stop a process by ID or name |
| `watch_list` | List all running processes |
| `watch_status` | Get detailed status of one process |
| `watch_output` | Get recent output (with `since_seq` or `since_seconds_ago`) |
| `watch_wait` | Block until new output/match arrives |
| `watch_input` | Send text to stdin |

### Example workflow

**1. Start a TypeScript watcher:**

```typescript
// LLM calls:
{
  "name": "watch_start",
  "arguments": {
    "command": "tsc",
    "args": ["--watch"],
    "cwd": "/path/to/project",
    "name": "tsc"
  }
}

// Returns:
Started process proc_1 (tsc). PID: 12345
Command: tsc --watch
CWD: /path/to/project
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

**3. Check incremental output:**

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

**4. View all processes:**

```typescript
{
  "name": "watch_list"
}
```

## Features

- **Multiple processes**: Run several watchers simultaneously (tsc + jest + cargo watch, etc.)
- **Ring buffer**: 500-line rolling buffer with seq numbers and timestamps
- **Flexible queries**: Use `since_seq` for polling or `since_seconds_ago` for time-based queries
- **Blocking wait**: `watch_wait` blocks with optional substring matching (ideal for "wait for build to finish")
- **Stdin support**: Send input to interactive prompts via `watch_input`
- **No persistence**: All processes are killed on session shutdown (fresh start each time)
- **Abort-safe**: `watch_wait` honors the agent abort signal (Esc cancels)

## Differences from original watch-mcp

The original `index.js` was an MCP server using `@modelcontextprotocol/sdk`. This extension:

- Is native to pi (no MCP protocol layer)
- Supports multiple concurrent processes
- Uses pi's tool calling interface directly
- Follows pi-headless-subagent patterns (state management, cleanup on shutdown)

## License

MIT
