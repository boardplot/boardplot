import { NormalizeError } from './normalize/shared';

/** Raster-only data URIs keep SVG, HTML and React exports self-contained. */
export function assertEmbeddedImage(src: string): void {
  const match = typeof src === 'string' && /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(src);
  if (!match || match[2]!.length % 4 !== 0) {
    throw new NormalizeError('unsupported-media', 'media', 'Use an embedded base64 PNG, JPEG or WebP image. External sources and SVG images are not supported.');
  }
  const bytes = atob(match[2]!.slice(0, 24));
  const valid = match[1] === 'png' ? bytes.startsWith('\x89PNG\r\n\x1a\n')
    : match[1] === 'jpeg' ? bytes.startsWith('\xff\xd8\xff')
    : bytes.startsWith('RIFF') && bytes.slice(8, 12) === 'WEBP';
  if (!valid) throw new NormalizeError('unsupported-media', 'media', 'The embedded image header does not match its declared format.');
}
