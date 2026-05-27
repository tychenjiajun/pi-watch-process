import { EventEmitter } from "node:events";

export const DEFAULT_MAX_LINES = 500;

export interface BufferedLine {
  seq: number;
  source: "stdout" | "stderr" | "system";
  text: string;
  ts: number; // Date.now()
}

export type LineSource = BufferedLine["source"];

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

  latestTs(): number | undefined {
    return this.lines.length > 0
      ? this.lines[this.lines.length - 1].ts
      : undefined;
  }

  length(): number {
    return this.lines.length;
  }

  waitForLine(
    sinceSeq: number,
    timeoutMs: number,
    match?: string,
    signal?: AbortSignal,
    matchRegex?: string,
    sources?: LineSource[],
  ): Promise<BufferedLine[]> {
    const needle = match ? match.toLowerCase() : null;
    const regex = matchRegex ? new RegExp(matchRegex, "i") : null;

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
    if (existing.length > 0) return Promise.resolve(existing);

    const collected: BufferedLine[] = [];

    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        cleanup();
        resolve(collected);
      }, timeoutMs);

      const onAbort = () => {
        cleanup();
        resolve(collected);
      };

      if (signal) {
        if (signal.aborted) {
          clearTimeout(timer);
          return resolve(collected);
        }
        signal.addEventListener("abort", onAbort, { once: true });
      }

      function handler(entry: BufferedLine) {
        if (entry.seq <= sinceSeq) return;
        collected.push(entry);
        if (lineMatches(entry)) {
          cleanup();
          resolve(collected);
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
