import { EventEmitter } from "node:events";

export const DEFAULT_MAX_LINES = 500;

export interface BufferedLine {
  seq: number;
  source: "stdout" | "stderr" | "system";
  text: string;
  ts: number; // Date.now()
}

export type LineSource = BufferedLine["source"];

export interface WaitResult {
  /** Lines collected while waiting (may include non-matching lines). */
  lines: BufferedLine[];
  /** True when the wait resolved because a line matched the filter. */
  matched: boolean;
  /** True when the timeout elapsed before a matching line arrived. */
  timedOut: boolean;
}

export class RingBuffer {
  private maxLines: number;
  private lines: BufferedLine[] = [];
  private seq = 0;
  private bus = new EventEmitter();

  constructor(maxLines: number = DEFAULT_MAX_LINES) {
    this.maxLines = maxLines;
  }

  push(source: BufferedLine["source"], text: string): BufferedLine {
    const entry: BufferedLine = { seq: ++this.seq, source, text, ts: Date.now() };
    this.lines.push(entry);
    if (this.lines.length > this.maxLines) this.lines.shift();
    this.bus.emit("line", entry);
    return entry;
  }

  getLines(
    sinceSeq?: number,
    sinceSecondsAgo?: number,
    limit?: number,
    sources?: LineSource[],
  ): BufferedLine[] {
    let filtered = this.lines;
    if (sinceSecondsAgo !== undefined && sinceSecondsAgo > 0) {
      const cutoff = Date.now() - sinceSecondsAgo * 1000;
      filtered = filtered.filter((l) => l.ts >= cutoff);
    }
    if (sinceSeq !== undefined && sinceSeq > 0) {
      filtered = filtered.filter((l) => l.seq > sinceSeq);
    }
    if (sources !== undefined && sources.length > 0) {
      filtered = filtered.filter((l) => sources.includes(l.source));
    }
    const cap = Math.min(limit ?? 50, 200);
    return filtered.slice(-cap);
  }

  latestSeq(): number {
    return this.seq;
  }

  /**
   * Find the sequence number of the first line within the last N seconds.
   * Returns (seq - 1) so it can be used as effectiveSinceSeq directly.
   * Searches the entire buffer without a line limit (unlike getLines).
   */
  firstSeqSince(sinceSecondsAgo: number): number | undefined {
    const cutoff = Date.now() - sinceSecondsAgo * 1000;
    const first = this.lines.find((l) => l.ts >= cutoff);
    return first ? first.seq - 1 : undefined;
  }

  latestTs(): number | undefined {
    return this.lines.length > 0
      ? this.lines[this.lines.length - 1].ts
      : undefined;
  }

  length(): number {
    return this.lines.length;
  }

  /**
   * Drop all `waitForLine` listeners without touching buffered data.
   * Used on hot module replacement (extension reload) so waiters from the
   * previous runtime do not leak into the freshly loaded one while the child
   * process keeps running.
   */
  clearListeners(): void {
    this.bus.removeAllListeners();
  }

  waitForLine(
    sinceSeq: number,
    timeoutMs: number,
    match?: string,
    signal?: AbortSignal,
    matchRegex?: string,
    sources?: LineSource[],
  ): Promise<WaitResult> {
    const needle = match ? match.toLowerCase() : null;
    const regex = matchRegex ? new RegExp(matchRegex, "i") : null;

    const hasFilter = needle !== null || regex !== null;
    const lineMatches = (l: BufferedLine): boolean => {
      if (needle && !l.text.toLowerCase().includes(needle)) return false;
      if (regex && !regex.test(l.text)) return false;
      if (sources && sources.length > 0 && !sources.includes(l.source)) return false;
      return true;
    };

    // Check existing lines first
    const existing = this.lines.filter(
      (l) => l.seq > sinceSeq && lineMatches(l),
    );
    if (existing.length > 0) {
      return Promise.resolve({ lines: existing, matched: true, timedOut: false });
    }

    const collected: BufferedLine[] = [];

    return new Promise((resolve) => {
      const finish = (matched: boolean, timedOut: boolean) => {
        cleanup();
        resolve({ lines: collected, matched, timedOut });
      };

      const timer = setTimeout(() => finish(false, true), timeoutMs);

      const onAbort = () => finish(false, false);

      if (signal) {
        if (signal.aborted) {
          clearTimeout(timer);
          return resolve({ lines: collected, matched: false, timedOut: false });
        }
        signal.addEventListener("abort", onAbort, { once: true });
      }

      function handler(entry: BufferedLine) {
        if (entry.seq <= sinceSeq) return;
        collected.push(entry);
        // Without an explicit filter, any new line resolves the wait.
        if (!hasFilter || lineMatches(entry)) {
          finish(true, false);
        }
      }

      this.bus.on("line", handler);

      const cleanup = () => {
        clearTimeout(timer);
        this.bus.off("line", handler);
        if (signal) signal.removeEventListener("abort", onAbort);
      };
    });
  }
}
