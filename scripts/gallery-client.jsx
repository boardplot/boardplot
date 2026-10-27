// The browser half of the gallery. scripts/gallery.mjs bundles it into
// artifacts/gallery/gallery.js: it mounts BoardplotChart for every fixture on a
// type page, points the SVG and PNG panes at the files of the chosen theme,
// and draws the scheme, theme and pane switches.
import { createRoot } from 'react-dom/client';
import '../dist/geo/index.js';
import { BoardplotChart } from '../dist/react/spec.js';

const page = JSON.parse(document.getElementById('gallery-data').textContent);
const STORE = 'boardplot-gallery';
const DEFAULT = page.themes[0];
const PANES = { react: 'React', svg: 'SVG', png: 'PNG' };
// Boardroom, light, the SVG pane only: the chart as `boardplot render` returns it. The other panes are a click away.
const state = { theme: DEFAULT.key, hidden: ['react', 'png'] };
try {
  Object.assign(state, JSON.parse(localStorage.getItem(STORE)) ?? {});
} catch {
  // No storage (private window, blocked site data): the page starts on the default.
}
if (!page.themes.some((theme) => theme.key === state.theme)) state.theme = DEFAULT.key;
const current = () => page.themes.find((theme) => theme.key === state.theme);
const esc = (value) => String(value).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** Each block shows one fixture at a time; a variant block switches between its members. */
const active = (block) => Number(block.dataset.active);
const roots = new Map();
function chart(index) {
  const fixture = page.fixtures[index];
  // The spec's own theme, or the default preset, is the spec as written. A pin
  // without colour overrides takes the chosen preset and keeps its overrides.
  if (fixture.ownTheme || state.theme === DEFAULT.key) return <BoardplotChart spec={fixture.spec} hover fixedSize idPrefix={`fx${index}`} />;
  if (fixture.pinned) {
    const theme = typeof fixture.pinned === 'string' ? state.theme : { ...fixture.pinned, preset: state.theme };
    return <BoardplotChart spec={{ ...fixture.spec, options: { ...fixture.spec.options, theme } }} hover fixedSize idPrefix={`fx${index}`} />;
  }
  return <BoardplotChart spec={fixture.spec} theme={state.theme} hover fixedSize idPrefix={`fx${index}`} />;
}
const observer = new IntersectionObserver((entries) => {
  for (const entry of entries) {
    if (!entry.isIntersecting) continue;
    observer.unobserve(entry.target);
    const block = entry.target.closest('.fx');
    const root = createRoot(entry.target);
    roots.set(block, root);
    root.render(chart(active(block)));
    // The reserved height only holds the page still until the chart mounts; a
    // table whose row groups collapse must be free to shrink.
    entry.target.style.minHeight = '';
  }
}, { rootMargin: '800px 0px' });
document.querySelectorAll('[data-react]').forEach((element) => observer.observe(element));

const button = (kind, value, label, pressed) =>
  `<button type="button" data-${kind}="${esc(value)}" aria-pressed="${pressed}">${esc(label)}</button>`;

function controls() {
  const theme = current();
  const scheme = `<span class="label">Scheme</span><span class="group">${['light', 'dark'].map((option) => button('scheme', option, option === 'light' ? 'Light' : 'Dark', option === theme.scheme)).join('')}</span>`;
  // The index has no charts, so only the scheme applies there.
  document.getElementById('controls').innerHTML = !page.fixtures.length ? scheme : `${scheme}
<span class="label">Theme</span><span class="group">${page.themes.filter((option) => option.scheme === theme.scheme).map((option) => button('theme', option.key, option === DEFAULT ? `${option.label} (default)` : option.label, option.key === theme.key)).join('')}</span>
<span class="label">Panes</span><span class="group">${Object.entries(PANES).map(([pane, label]) => button('pane', pane, label, !state.hidden.includes(pane))).join('')}</span>`;
}

function files(fixture, theme) {
  const dir = fixture.ownTheme ? 'authored' : theme.dir;
  return { dir, result: fixture.renders[dir] };
}

const fixOf = (fix) => fix.map(({ op, path, value }) => `${op} ${path}${value === undefined ? '' : ` ${JSON.stringify(value)}`}`).join('; ');
function refusal(result) {
  const errors = result?.errors ?? [{ code: 'not-rendered', message: 'The gallery has no render for this theme.' }];
  return `<div class="refused"><strong>The CLI refused this spec.</strong>${errors.map((error) => `<br><code>${esc(error.code)}</code>${error.path ? ` at <code>${esc(error.path)}</code>` : ''}: ${esc(error.message)}${
    error.suggest ? `<br>Fix: ${esc(error.suggest)}` : ''}${error.fix?.length ? ` <code>${esc(fixOf(error.fix))}</code>` : ''}`).join('')}</div>`;
}

function panes(block, fixture, theme) {
  const { dir, result } = files(fixture, theme);
  const base = `${page.type}/${dir}/`;
  const svg = block.querySelector('[data-pane="svg"]');
  const png = block.querySelector('[data-pane="png"]');
  const label = fixture.ownTheme ? 'theme pinned by the fixture' : fixture.pinned && theme.key !== DEFAULT.key ? `${theme.key} with the fixture's overrides` : theme.key;
  if (!result?.png) {
    svg.querySelector('figcaption').textContent = `SVG from boardplot render, ${label}`;
    png.querySelector('figcaption').textContent = `PNG, scale 2, ${label}`;
    svg.querySelector('.body').innerHTML = refusal(result);
    png.querySelector('.body').innerHTML = refusal(result);
  } else {
    const { width, height } = result.size;
    const svgFile = `${base}${encodeURIComponent(fixture.id)}.svg`;
    const pngFile = `${base}${encodeURIComponent(result.png)}`;
    svg.querySelector('figcaption').innerHTML = `SVG from boardplot render (CLI and MCP), ${esc(label)}, ${width} × ${height} · <a href="${svgFile}" target="_blank" rel="noopener">open file</a>`;
    png.querySelector('figcaption').innerHTML = `PNG at scale 2, shown at the chart's own size as PowerPoint places it · <a href="${pngFile}" target="_blank" rel="noopener">open file</a>`;
    svg.querySelector('.body').innerHTML = `<img src="${svgFile}" width="${width}" height="${height}" loading="lazy" alt="SVG of ${esc(fixture.id)}">`;
    png.querySelector('.body').innerHTML = `<img src="${pngFile}" width="${width}" height="${height}" loading="lazy" alt="PNG of ${esc(fixture.id)}">`;
  }
  const findings = result?.warnings ?? [];
  block.querySelector('.findings').innerHTML = result?.errors
    ? ''
    : findings.length
      ? findings.map((finding) => `<li class="${esc(finding.severity)}"><code>${esc(finding.code)}</code> ${esc(finding.severity)}: ${esc(finding.message)}</li>`).join('')
      : '<li>The CLI reports no warnings for this theme.</li>';
}

function apply() {
  const theme = current();
  const root = document.documentElement;
  root.dataset.scheme = theme.scheme;
  for (const [name, value] of Object.entries(theme.colors)) root.style.setProperty(`--${name}`, value);
  document.body.dataset.hide = state.hidden.join(' ');
  controls();
  document.querySelectorAll('section.fx').forEach((block) => panes(block, page.fixtures[active(block)], theme));
  for (const [block, reactRoot] of roots) reactRoot.render(chart(active(block)));
}

function show(block, index) {
  block.dataset.active = String(index);
  block.querySelectorAll('[data-member]').forEach((member) => { member.hidden = Number(member.dataset.member) !== index; });
  block.querySelectorAll('[data-variant]').forEach((button) => button.setAttribute('aria-pressed', String(Number(button.dataset.variant) === index)));
  panes(block, page.fixtures[index], current());
  roots.get(block)?.render(chart(index));
}

document.querySelector('main')?.addEventListener('click', (event) => {
  const target = event.target.closest('[data-variant]');
  if (target) show(target.closest('.fx'), Number(target.dataset.variant));
});

/** A link to a variant that is not shown switches its block to it. */
function follow() {
  const member = location.hash && document.getElementById(decodeURIComponent(location.hash.slice(1)));
  // No hash leaves member '' (a string has no dataset): nothing to follow.
  if (!member || member.dataset.member === undefined || !member.hidden) return;
  const block = member.closest('.fx');
  show(block, Number(member.dataset.member));
  block.scrollIntoView();
}
window.addEventListener('hashchange', follow);

document.getElementById('controls').addEventListener('click', (event) => {
  const target = event.target.closest('button');
  if (!target) return;
  const theme = current();
  const { scheme, theme: key, pane } = target.dataset;
  if (scheme && scheme !== theme.scheme) {
    // The same family in the other scheme where the engine ships one, else that scheme's first theme.
    const others = page.themes.filter((option) => option.scheme === scheme);
    state.theme = (others.find((option) => option.label === theme.label) ?? others[0]).key;
  } else if (key) {
    state.theme = key;
  } else if (pane) {
    state.hidden = state.hidden.includes(pane) ? state.hidden.filter((hidden) => hidden !== pane) : [...state.hidden, pane];
  }
  try {
    localStorage.setItem(STORE, JSON.stringify(state));
  } catch {
    // The choice lasts for this page only.
  }
  apply();
});

apply();
follow();
