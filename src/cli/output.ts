/** Where the CLI's output goes: the process's own console, one JSON line on stdout. */

export function printOut(...values: unknown[]): void {
  console.log(...values);
}

export function printError(...values: unknown[]): void {
  console.error(...values);
}
