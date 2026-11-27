// The package build replaces authored prose with slots. A schema may be built
// before a reader imports the dictionary or may copy an earlier field's text.
let words: readonly string[] | undefined;
const snapshots: object[] = [];

export function field(index: number) {
  return { get description() { return words?.[index] ?? '\x01' + index + '\x02'; } };
}

function expand(text: string): string {
  return text.replace(/\x01(\d+)\x02/g, (_, slot: string) => words![Number(slot)]!);
}

export function composed(raw: string | undefined) {
  let decoded: string | undefined;
  return { get description() { return words && raw !== undefined ? decoded ??= expand(raw) : raw; } };
}

// Zod keeps the metadata object by reference. Grid copies its input schema
// to JSON and the icon field copies its enum and description at construction.
export function snapshot<T extends object>(value: T): T {
  if (!words) snapshots.push(value);
  return value;
}

export function install(dictionary: readonly string[]): void {
  if (words) return;
  words = dictionary;
  function restore(value: object) {
    for (const [key, child] of Object.entries(value)) {
      if (key === 'description' && typeof child === 'string') (value as { description: string }).description = expand(child);
      else if (child && typeof child === 'object') restore(child);
    }
  }
  snapshots.forEach(restore);
  snapshots.length = 0;
}
