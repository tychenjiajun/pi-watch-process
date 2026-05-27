# pi-watch-process

Pi 扩展，用于管理 CLI 模式的 watch 进程。直接从 LLM 启动、监控和控制长时间运行的命令，例如 `tsc --watch`、`jest --watch` 或 `cargo watch`。

## 安装

放置在自动发现目录或使用 `--extension`：

```bash
# 快速测试
pi -e /path/to/pi-watch-process/index.ts

# 全局安装
ln -s ~/projects/pi-watch-process ~/.pi/agent/extensions/watch-process

# 项目本地
mkdir -p .pi/extensions
ln -s ~/projects/pi-watch-process .pi/extensions/watch-process
```

或通过 `settings.json` 配置：

```json
{
  "extensions": ["/path/to/pi-watch-process"]
}
```

## 使用

加载后，LLM 可以使用以下 7 个工具，另外还有 7 个斜杠命令用于手动控制：

## 斜杠命令（手动控制）

| 命令 | 描述 | 示例 |
|------|------|------|
| `/watch-start` | 启动一个进程 | `/watch-start tsc --watch --name tsc` |
| `/watch-stop` | 停止一个进程 | `/watch-stop proc_1` |
| `/watch-list` | 列出所有进程 | `/watch-list` |
| `/watch-status` | 显示详细状态 | `/watch-status proc_1` |
| `/watch-output` | 显示最近输出 | `/watch-output proc_1 --since 100 --limit 50` |
| `/watch-wait` | 等待新输出 | `/watch-wait proc_1 --match "error" --timeout 30000` |
| `/watch-input` | 向 stdin 发送文本 | `/watch-input proc_1 q` |

### 命令选项

- `--name <name>`：为进程分配一个易读的名称
- `--since <seq|seconds>`：按序列号或时间过滤输出（例如 `100` 或 `60s`）
- `--limit <n>`：限制输出行数（默认 50）
- `--match <text>`：等待包含指定文本的输出（不区分大小写）
- `--timeout <ms>`：最大等待时间（毫秒）（默认 15000，最大 60000）

## LLM 工具

| 工具 | 描述 | 主要参数 |
|------|------|----------|
| `watch_start` | 启动一个进程 | `{command, args[], cwd?, name?}` |
| `watch_stop` | 通过 ID 或名称停止进程 | `{process}` |
| `watch_list` | 列出所有运行中的进程 | — |
| `watch_status` | 获取单个进程的详细状态 | `{process}` |
| `watch_output` | 获取最近的输出 | `{process, since_seq?, since_seconds_ago?, limit?}` |
| `watch_wait` | 阻塞直到有新输出/匹配内容 | `{process, since_seq?, since_seconds_ago?, timeout_ms?, match?}` |
| `watch_input` | 向 stdin 发送文本 | `{process, text}` |

### 使用示例

**1. 启动 TypeScript watcher：**

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

**2. 等待编译完成：**

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

**3. 获取增量输出（轮询）：**

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

**4. 获取最近 60 秒的输出：**

```typescript
{
  "name": "watch_output",
  "arguments": {
    "process": "proc_1",
    "since_seconds_ago": 60
  }
}
```

**5. 查看所有进程：**

```typescript
{
  "name": "watch_list"
}
```

## 功能特性

- **多进程支持**：同时运行多个 watcher（例如 tsc + jest + cargo watch）
- **灵活引用**：通过自动生成的 ID（`proc_1`）或易读的名称（`tsc`）引用进程
- **环形缓冲区**：500 行滚动缓冲区，带有序列号和时间戳
- **灵活查询**：使用 `since_seq` 进行轮询，或使用 `since_seconds_ago` 进行时基查询
- **阻塞等待**：`watch_wait` 可阻塞并支持子串匹配（适合「等待构建完成」场景）
- **stdin 支持**：通过 `watch_input` 向交互式提示发送输入
- **无持久化**：会话结束时终止所有进程（每次重新启动都是全新的）
- **中断安全**：`watch_wait` 遵守代理 abort 信号（按 Esc 可取消等待）
- **ANSI 清理**：输出自动去除终端转义码
- **来源标记**：每行都被标记为 `stdout`、`stderr` 或 `system`

## 技术细节

- 无需构建 —— 通过 jiti 实时编译 TypeScript
- 遵循 `pi-headless-subagent` 的模式（状态管理、关闭时清理）
- Peer 依赖：`@earendil-works/pi-coding-agent`, `@sinclair/typebox`
- 纯 Node.js 实现，使用 `child_process.spawn` 和 `EventEmitter`

## 许可证

MIT
