/**
 * The reference comparison page of the gallery, built only with
 * `npm run gallery -- --compare <dir>`. It reads <dir>/manifest.json:
 *
 *   { "title": "Page title",
 *     "entries": [{ "title": "…", "original": "originals/a.png", "rebuild": "/abs/a.png", "notes": "…" }] }
 *
 * Image paths resolve against <dir>. Both images are copied into the gallery
 * output, never into the repository, so reference material stays outside git.
 * An entry without a rebuild file shows "rebuild pending".
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';

const esc = (value) => String(value).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const json = (value) => JSON.stringify(value).replace(/</g, '\\u003c');

// The page chrome follows the gallery's scheme switch; the images keep their own colours on white.
const STYLE = `.cmp{border-top:1px solid var(--line);padding:20px 0 28px}
.cmp>h2{font-size:16px;margin:0 0 10px}
.cmp>h2>a{color:inherit}
.pair{display:flex;gap:16px;align-items:stretch}
.pair>figure{margin:0;flex:1 1 0;min-width:0;display:flex;flex-direction:column}
.pair figcaption{color:var(--muted);font-size:12px;margin-bottom:6px}
.pair img{display:block;width:100%;height:auto;background:#fff;outline:1px solid var(--line)}
.pending{flex:1;min-height:120px;display:flex;align-items:center;justify-content:center;border:1px dashed var(--muted);color:var(--muted);font-style:italic}
.notes{color:var(--muted);max-width:980px;margin:10px 0 0}
@media (max-width:720px){.pair{display:block}.pair>figure{margin-bottom:16px}}`;
// Each figure grows by its image's width-to-height ratio, so both images of a row come out at one height.
const FIT = `for(const img of document.querySelectorAll('.pair img')){const fit=()=>{const ratio=img.naturalWidth/img.naturalHeight||1;img.closest('figure').style.flexGrow=ratio;const pending=img.closest('.pair').querySelector('.pending');if(pending)pending.parentNode.style.flexGrow=ratio};img.complete?fit():img.addEventListener('load',fit)}`;

/** Copies the images to <out>/reference-compare/ and returns the page title and HTML. */
export function comparePage(dir, out, themes) {
  const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
  if (typeof manifest.title !== 'string' || !Array.isArray(manifest.entries)) {
    throw new Error(`${join(dir, 'manifest.json')} needs a "title" string and an "entries" array`);
  }
  mkdirSync(join(out, 'reference-compare'), { recursive: true });
  const copy = (file, name) => {
    const from = file && resolve(dir, file);
    if (!from || !existsSync(from)) return undefined;
    const to = `reference-compare/${name}${extname(from).toLowerCase()}`;
    copyFileSync(from, join(out, to));
    return to;
  };
  const figure = (label, src, alt) => `<figure><figcaption>${label}</figcaption><a href="${esc(src)}" target="_blank" rel="noopener" title="Open at full size"><img src="${esc(src)}" alt="${esc(alt)}"></a></figure>`;
  let rebuilt = 0;
  const rows = manifest.entries.map((entry, index) => {
    const n = String(index + 1).padStart(2, '0');
    const original = copy(entry.original, `${n}-original`);
    if (!original) throw new Error(`compare entry ${n} (${entry.title}): original ${entry.original} not found`);
    const rebuild = copy(entry.rebuild, `${n}-rebuild`);
    if (rebuild) rebuilt++;
    return `<section class="cmp" id="cmp-${n}"><h2><a href="#cmp-${n}">${n}</a> ${esc(entry.title ?? '')}</h2>
<div class="pair">${figure('Original', original, `Original: ${entry.title ?? n}`)}${rebuild
      ? figure('Boardplot rebuild', rebuild, `Boardplot rebuild: ${entry.title ?? n}`)
      : '<figure><figcaption>Boardplot rebuild</figcaption><div class="pending">rebuild pending</div></figure>'}</div>
${entry.notes ? `<p class="notes">${esc(entry.notes)}</p>` : ''}</section>`;
  });
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(manifest.title)} · Boardplot gallery</title><link rel="stylesheet" href="gallery.css"><style>${STYLE}</style></head>
<body><header class="top"><h1>${esc(manifest.title)}</h1><span class="nav"><a href="index.html">All types</a></span><nav id="controls" aria-label="Page switches"></nav></header>
<main><p class="intro">${rows.length} exhibits, ${rebuilt} rebuilt in Boardplot, ${rows.length - rebuilt} pending. Left the original, right the rebuild, both at one height. Click an image to open it at full size.</p>
${rows.join('\n')}</main>
<script type="application/json" id="gallery-data">${json({ type: null, themes, fixtures: [] })}</script><script src="gallery.js"></script><script>${FIT}</script></body></html>
`;
  return { title: manifest.title, html };
}
