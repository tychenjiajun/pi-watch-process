// Minimal watch-mode-like CLI used by the smoke test.
process.stdout.on("error", () => {});
let tick = 0;
const log = (s) => process.stdout.write(s + "\n");

log("build start");
log("Found 0 errors");
const timer = setInterval(() => {
  tick += 1;
  log(`tick ${tick}`);
}, 200);

process.stdin.setEncoding("utf8");
process.stdin.on("data", (data) => {
  for (const line of data.split("\n").filter(Boolean)) {
    log(`got: ${line}`);
    if (line === "q") {
      log("bye");
      process.exit(0);
    }
  }
});

process.on("SIGTERM", () => {
  log("SIGTERM");
  clearInterval(timer);
  process.exit(0);
});