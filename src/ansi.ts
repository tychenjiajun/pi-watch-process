/** Strip ANSI escape sequences from a string. */
export const stripAnsi = (s: string): string =>
  s.replace(/\x1B\[[0-9;]*[A-Za-z]/g, "").replace(/\x1B\][^\x07]*\x07/g, "");
