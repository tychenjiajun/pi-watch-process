# pi-watch-process

Pi 扩展，用于管理 CLI 模式的 watch 进程。直接从 LLM —— 或从 [codemode](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/codemode.md) 脚本 —— 启动、监控、热重启和控制长时间运行的命令，例如 `tsc --watch`、`jest --watch` 或 `cargo watch`。

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

## 工具

加载后，LLM 和 codemode 脚本可以使用以下 8 个工具。

| 工具 | 描述 | 主要参数 |
|------|------|----------|
| `watch_start` | 启动一个进程 | `{command, args[], cwd?, name?, bufferSize?}` |
| `watch_stop` | 通过 ID 或名称停止进程 | `{process}` |
| `watch_restart` | 原地热重启（保留 ID、名称与历史） | `{process}` |
| `watch_list` | 列出所有被跟踪的进程 | `{includeCompleted?}` |
| `watch_status` | 获取单个进程的详细状态 | `{process}` |
| `watch_output` | 获取最近的输出 | `{process, since_seq?, since_seconds_ago?, limit?, sources?}` |
| `watch_wait` | 阻塞直到有新输出/匹配内容 | `{process, since_seq?, since_seconds_ago?, timeout_ms?, match?, matchRegex?, sources?}` |
| `watch_input` | 向 stdin 发送文本 | `{process, text}` |

### 使用示例

**1. 启动 TypeScript watcher：**

```jsonc
{ "name": "watch_start", "arguments": { "command": "tsc", "args": ["--watch"], "cwd": "/path/to/project", "name": "tsc" } }
// → Started process proc_1 (tsc). PID: 12345
```

**2. 等待编译完成：**

```jsonc
{ "name": "watch_wait", "arguments": { "process": "proc_1", "match": "Found X error(s)", "timeout_ms": 30000 } }
```

**3. 轮询增量输出：**

```jsonc
{ "name": "watch_output", "arguments": { "process": "tsc", "since_seq": 42, "limit": 50 } }
```

**4. 修改被监视的配置后热重启：**

```jsonc
{ "name": "watch_restart", "arguments": { "process": "tsc" } }
```

## Codemode

每个工具都声明了 `outputSchema` 并返回 `structuredContent`，因此 codemode 脚本拿到的是数据，而不是需要解析的文本。成功结果为 `{ ok: true, ... }`；失败结果带 `isError: true` 和 `{ ok: false, error }`，脚本无需 `try/catch` 即可分支。

```js
// 一个脚本内：启动构建、等待稳定、再检查结构化输出。
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

`watch_wait` 是一个真正挂起的工具调用，因此在没有定时器的 codemode 沙箱中也能正常工作。由于结果是结构化的，脚本可以并行操作多个 watcher，并在模型看到之前先过滤输出。

## 热模块替换（HMR）

本扩展可以在 `/reload` 后继续存活：

- 进程注册表存放在 `globalThis`，而不是模块作用域，因此重载后的运行时**接管仍在运行的子进程**及其环形缓冲区，既不泄漏也不会丢失。
- 上一个运行时挂载的 `data` / `close` 处理器会继续写入同一批缓冲区，因此重载期间不会丢失输出。
- 当 `session_shutdown` 的原因为 `reload` 时，只分离挂起的 `watch_wait` 监听器，子进程**继续运行**。其他关闭原因（`quit`、`new`、`resume`、`fork`）会终止所有子进程。
- `watch_restart` 是进程内的 HMR 原语：原地停止并重启 watcher，同时保留其 ID、名称与缓冲历史。

## 与 LSP 的关系

本扩展与语言服务器是互补关系，而非替代品。完整对比见 [docs/vs-lsp.md](./docs/vs-lsp.md) —— 简而言之：LSP 在精确、结构化的语言诊断上更胜一筹；watch-process 则在任何以 CLI 形式运行的东西（构建、测试、linter、开发服务器）以及任何交互式场景中更胜一筹。

## 功能特性

- **多进程支持**：同时运行多个 watcher（例如 tsc + jest + cargo watch）
- **灵活引用**：通过自动生成的 ID（`proc_1`）或易读的名称（`tsc`）引用进程
- **环形缓冲区**：500 行滚动缓冲区，带有序列号和时间戳
- **灵活查询**：使用 `since_seq` 进行轮询，或使用 `since_seconds_ago` 进行时基查询
- **阻塞等待**：`watch_wait` 可阻塞并支持子串或正则匹配（适合「等待构建完成」场景）
- **结构化结果**：每个工具都有供 codemode 使用的 `outputSchema`；模型仍能获得可读文本
- **HMR 安全**：重载会接管运行中的进程；`watch_restart` 可原地热重启
- **stdin 支持**：通过 `watch_input` 向交互式提示发送输入
- **无持久化**：真正关闭会话时终止所有进程（每次重新启动都是全新的）
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