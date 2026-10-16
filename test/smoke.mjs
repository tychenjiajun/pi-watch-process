// Deterministic smoke test for the action layer + HMR registry.
// Runs against the compiled output in dist/ (see `npm test`).
//
//   node test/smoke.mjs
//
// It exercises: start -> wait(match) -> output -> input -> detach(lossless HMR)
// -> restart(in place) -> stop -> global-registry identity.

import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import {
  actionStart,
  actionStop,
  actionRestart,
  actionList,
  actionOutput,
  actionWait,
  actionInput,
} from "../dist/src/actions.js";
import {
  killAll,
  detachAllWaiters,
  processes,
} from "../dist/src/process.js";
import { toProcessSummary } from "../dist/src/format.js";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");
const fixture = resolve(here, "fixtures/fake-watch.mjs");

let failures = 0;
const check = (label, fn) => {
  try {
    fn();
    console.log(`  ✓ ${label}`);
  } catch (err) {
    failures += 1;
    console.error(`  ✗ ${label}\n    ${err.message}`);
  }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  console.log("pi-watch-process smoke test\n");

  // ── start ──────────────────────────────────────────────────────────────────
  const started = actionStart({
    command: process.execPath,
    args: [fixture],
    cwd: repoRoot,
    name: "fake",
  });
  assert.equal(started.ok, true, "actionStart should succeed");
  const proc = started.value;
  console.log(`started ${proc.id} (${proc.name}) pid=${proc.child?.pid}`);

  check("start assigns a stable id and name", () => {
    assert.equal(proc.id, "proc_1");
    assert.equal(proc.name, "fake");
    assert.equal(typeof proc.child?.pid, "number");
  });

  // ── wait for a known line ───────────────────────────────────────────────────
  const waited = await actionWait({
    process: proc.id,
    match: "build start",
    timeout_ms: 3000,
  });
  check("wait matches startup output", () => {
    assert.equal(waited.ok, true);
    assert.equal(waited.value.matched, true);
    assert.equal(waited.value.timedOut, false);
    assert.ok(waited.value.lines.some((l) => l.text.includes("build start")));
  });

  await sleep(300);
  const out = actionOutput({ process: "fake", limit: 100 });
  check("output returns tagged, sequenced lines", () => {
    assert.equal(out.ok, true);
    assert.ok(out.value.lines.length > 0);
    assert.ok(out.value.lines.every((l) => l.seq > 0 && l.ts > 0));
    assert.ok(out.value.lines.some((l) => l.text.includes("tick")));
  });

  // ── stdin ───────────────────────────────────────────────────────────────────
  const input = actionInput("proc_1", "hello");
  assert.equal(input.ok, true, "actionInput should succeed");
  const echo = await actionWait({
    process: proc.id,
    match: "got: hello",
    timeout_ms: 3000,
  });
  check("input echoes through the process stdin", () => {
    assert.equal(echo.ok, true);
    assert.equal(echo.value.matched, true);
  });

  // ── HMR: reload must not kill children ──────────────────────────────────────
  const REGISTRY_KEY = Symbol.for("pi-watch-process.registry.v1");
  const globalRegistry = globalThis[REGISTRY_KEY];
  check("registry is pinned to a global symbol (survives /reload)", () => {
    assert.ok(globalRegistry, "registry missing on globalThis");
    assert.equal(globalRegistry.processes, processes);
    assert.equal(globalRegistry.processes.get(proc.id), proc);
  });

  const linesBeforeReload = proc.buffer.length();
  detachAllWaiters();
  check("detachAllWaiters keeps the child alive and buffered", () => {
    assert.equal(proc.exited, false, "child was killed on reload");
    assert.ok(proc.buffer.length() >= linesBeforeReload);
  });

  await sleep(300);
  const afterReload = await actionWait({
    process: proc.id,
    since_seq: out.value.lines.at(-1)?.seq ?? 0,
    timeout_ms: 3000,
  });
  check("a fresh runtime can still wait after reload", () => {
    assert.equal(afterReload.ok, true);
    assert.ok(afterReload.value.lines.length > 0, "no new lines after reload");
  });

  // ── restart in place ────────────────────────────────────────────────────────
  const startedAt = proc.startTime;
  await sleep(120);
  const restarted = await actionRestart(proc.id);
  check("restart preserves id/name/history and resets uptime", () => {
    assert.equal(restarted.ok, true);
    assert.equal(restarted.value.id, proc.id);
    assert.equal(restarted.value.name, "fake");
    assert.equal(restarted.value.exited, false);
    assert.ok(restarted.value.startTime >= startedAt);
    assert.ok(restarted.value.buffer.length() >= linesBeforeReload);
  });

  const summary = toProcessSummary(proc);
  check("structured summary is JSON-serializable and complete", () => {
    const roundTrip = JSON.parse(JSON.stringify(summary));
    assert.equal(roundTrip.id, proc.id);
    assert.equal(roundTrip.running, true);
    assert.deepEqual(roundTrip.args, [fixture]);
  });

  // ── list + stop ─────────────────────────────────────────────────────────────
  check("list reports the running process", () => {
    const list = actionList(false);
    assert.equal(list.length, 1);
    assert.equal(list[0].id, proc.id);
  });

  const stopped = await actionStop("fake");
  check("stop reports was_running and marks exited", () => {
    assert.equal(stopped.ok, true);
    assert.equal(stopped.value.wasRunning, true);
    assert.equal(stopped.value.process.exited, true);
  });

  const stoppedAgain = await actionStop(proc.id);
  check("stopping an already-stopped process is a no-op", () => {
    assert.equal(stoppedAgain.ok, true);
    assert.equal(stoppedAgain.value.wasRunning, false);
  });

  await killAll();

  console.log(`\n${failures === 0 ? "PASS" : `FAIL (${failures})`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});