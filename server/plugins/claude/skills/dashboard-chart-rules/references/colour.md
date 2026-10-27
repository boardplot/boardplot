# Colour tokens and contrast

Paint with the type's tokens as `var()`: they follow the theme, so the marks change with it. Read a token as a literal colour only for two jobs: to check a contrast, and to choose the text colour on a fill. A token can hold `var()`, `light-dark()`, `oklch()` or alpha, so the read goes through the page's own CSS.

## Read a token as a literal colour

The probe element resolves `var()` and `light-dark()`. The 1x1 canvas turns any CSS colour, alpha included, into 8-bit sRGB over the surface under it.

```js
function colourReader(host) {
  const probe = document.createElement('span');
  probe.style.display = 'none';
  host.appendChild(probe);
  const ctx = Object.assign(document.createElement('canvas'), { width: 1, height: 1 })
    .getContext('2d', { willReadFrequently: true });
  const read = (css, ground = '#ffffff') => {
    probe.style.color = '';
    probe.style.color = css;
    ctx.fillStyle = ground; ctx.fillRect(0, 0, 1, 1);
    ctx.fillStyle = getComputedStyle(probe).color; ctx.fillRect(0, 0, 1, 1);
    const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
    return '#' + [r, g, b].map((n) => n.toString(16).padStart(2, '0')).join('');
  };
  return { read, done: () => probe.remove() };
}
```

Read the surface the chart sits on first, then every colour over it. On a card the surface is `--color-panel`, not `--color-bg`:

```js
const reader = colourReader(host);
const page = reader.read('var(--color-bg)');
const surface = reader.read('var(--color-panel)', page);
const fg = reader.read('var(--color-fg)', surface);
const ok = reader.read('var(--color-ok)', surface);
const bad = reader.read('var(--color-bad)', surface);
const series = (dash.colors || []).map((c) => reader.read(c, surface));
reader.done();
```

## Contrast

The WCAG contrast ratio of two sRGB colours:

```js
function luminance(hex) {
  const n = parseInt(hex.slice(1), 16);
  const lin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * lin(n >> 16 & 255) + 0.7152 * lin(n >> 8 & 255) + 0.0722 * lin(n & 255);
}
function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
```

| Role | Floor | Against | Reason |
|---|---|---|---|
| Text: titles, labels, values | 4.5:1 | the surface under it | Small text below 4.5:1 is hard to read (WCAG 1.4.3). |
| Muted text: axis ticks, notes | 3:1 | the surface under it | Secondary text, still readable. |
| Marks: bars, lines, segments | 3:1 | the surface (`--color-panel` on a card) | Graphical objects that carry meaning (WCAG 1.4.11). |
| A label inside a mark | 4.5:1 | that mark's fill | The fill, not the card, is behind the text. |
| Good against bad | clearly apart, also for red-green colour blindness | each other | A reader who cannot tell them apart reads the change the wrong way. |

`--color-ok`, `--color-warn` and `--color-bad` are text colours. Used as a fill, each must pass the mark floor, and a label on it needs the label check.

## The text colour on a fill

Choose between `--color-fg` and `--color-panel` by contrast with the fill, then check the choice. Read each candidate composited over the actual fill before you compare it, because a token with alpha paints over the mark, not over the page:

```js
// Call before reader.done(); fillCss is the fill as painted, such as dash.colors[0].
const onFill = (reader, fillCss, surface) => {
  const fill = reader.read(fillCss, surface);
  const [best] = ['var(--color-fg)', 'var(--color-panel)']
    .map((css) => ({ css, ink: reader.read(css, fill) }))
    .sort((a, b) => contrast(b.ink, fill) - contrast(a.ink, fill));
  return contrast(best.ink, fill) >= 4.5 ? best.css : null; // null: put the label outside the mark
};
```

## When a colour fails

- Text: use `--color-fg`.
- Series: choose the replacements over the whole series map at once. Take, for each failing series, the next colour of `dash.colors` that passes and that no other series holds, so two series never share a colour. Keep the same colour for that series everywhere on the page.
- Then check the final palette: every series apart from the others, and good apart from bad.
- When no passing colour is left, tell the series apart by a pattern (hatch, dash) or a direct label instead of colour.
- Tell the person in your hand-over which colour you replaced or patterned, and why (for example, "the third series colour had 2.1:1 on the dark card").

## Light and dark

- The dashboard switches its theme with a `data-mode` attribute (`light`, `dark`, `system`). The media query applies only in `system` mode. Draw again on both:

```js
new MutationObserver(drawAll).observe(document.documentElement,
  { subtree: true, attributes: true, attributeFilter: ['data-mode'] });
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', drawAll);
```

- Each redraw reads the tokens again, so every check runs in the scheme in force.
- Prior-year tints and hatch lines must still pass 3:1 in dark. A light tint of a dark-scheme colour is darker, not lighter: mix toward the surface colour, not toward white.
