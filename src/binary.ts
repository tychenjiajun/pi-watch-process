import { existsSync } from "node:fs";
import { join, delimiter } from "node:path";

/**
 * Resolve a command name to an absolute binary path.
 * Checks node_modules/.bin first, then PATH.
 * Returns null if the binary cannot be found.
 */
export function resolveBinary(command: string, cwd: string): string | null {
  // Already a path (contains separator) — return as-is
  if (command.includes("/") || command.includes("\\")) {
    return command;
  }

  // On Windows, spawn (with shell) resolves .cmd/.exe/.bat — check them too
  const names =
    process.platform === "win32"
      ? [command, `${command}.cmd`, `${command}.exe`, `${command}.bat`]
      : [command];

  // 1. Try local node_modules/.bin first
  for (const name of names) {
    const localBin = join(cwd, "node_modules", ".bin", name);
    if (existsSync(localBin)) return localBin;
  }

  // 2. Search PATH
  const pathDirs = (process.env.PATH || "").split(delimiter);
  for (const dir of pathDirs) {
    for (const name of names) {
      const fullPath = join(dir, name);
      if (existsSync(fullPath)) return fullPath;
    }
  }

  return null;
}
