const encoder = new TextEncoder();

function asBufferSource(input: string | Uint8Array): ArrayBuffer {
  const source = typeof input === 'string' ? encoder.encode(input) : input;
  const copy = new Uint8Array(source.byteLength);
  copy.set(source);
  return copy.buffer;
}

/** SHA-256 hex via the host's Web Crypto API, without bundling Node crypto. */
export async function sha256Hex(input: string | Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', asBufferSource(input));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function utf8Bytes(text: string): Uint8Array {
  return encoder.encode(text);
}
