/*
 * Boardplot in a Claude Dashboard: draws each chart in CHARTS from its
 * dataset's rows, after the runtime files have set window.Boardplot.
 * Values from the data are untrusted text: the SVG goes in by DOM parsing
 * (DOMParser, then importNode), never as an HTML string.
 */
(function () {
  'use strict';
  /*
   * One entry per chart container. `columns` names the dataset's columns;
   * without a series column, every row joins one series called `seriesLabel`.
   * `options` holds the chart's text: no numbers (they come from the data) and
   * no source line (the dashboard's Sources shows it).
   */
  var CHARTS = [
    {
      container: 'bp-sales',
      dataset: 'sales',
      columns: { category: 'region', value: 'revenue' },
      seriesLabel: 'Revenue',
      spec: { type: 'column', options: { title: 'Revenue by region', unit: '€k' } }
    }
  ];
  var SERIES_KEY = '__bp_series';
  /** Complete presets with no colour findings of their own: the base for the dashboard's tokens, and the fallback. */
  var PRESET = { light: 'boardroom', dark: 'notation-dark' };

  var Boardplot = window.Boardplot;

  /** A CSS colour (a var(), light-dark() or any colour) as an opaque #rrggbb, composited over `ground`. */
  function literal(value, ground, probe, ctx) {
    if (!value) return undefined;
    probe.style.color = '';
    probe.style.color = String(value);
    var computed = getComputedStyle(probe).color;
    if (!computed) return undefined;
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillStyle = ground || '#ffffff';
    ctx.fillRect(0, 0, 1, 1);
    ctx.fillStyle = computed;
    ctx.fillRect(0, 0, 1, 1);
    var px = ctx.getImageData(0, 0, 1, 1).data;
    return '#' + [px[0], px[1], px[2]].map(function (n) { return (n < 16 ? '0' : '') + n.toString(16); }).join('');
  }

  function luminance(hex) {
    var n = parseInt(hex.slice(1), 16);
    return (0.2126 * (n >> 16 & 255) + 0.7152 * (n >> 8 & 255) + 0.0722 * (n & 255)) / 255;
  }

  /** dash.colors as a list for the current scheme: a list, a { light, dark } pair, or a function returning either. */
  function seriesColors(dark) {
    var colors = window.dash && dash.colors;
    if (typeof colors === 'function') colors = colors();
    if (colors && !Array.isArray(colors)) colors = dark ? colors.dark : colors.light;
    return Array.isArray(colors) ? colors : [];
  }

  /**
   * The request-local theme: the dashboard's tokens as literal colours on top
   * of the preset for its scheme. The scheme (light or dark) comes from the background.
   */
  function dashboardTheme(host) {
    var probe = document.createElement('span');
    probe.style.display = 'none';
    host.appendChild(probe);
    var canvas = document.createElement('canvas');
    canvas.width = 1; canvas.height = 1;
    var ctx = canvas.getContext('2d', { willReadFrequently: true });
    try {
      if (!ctx) return { scheme: 'light', theme: PRESET.light };
      var background = literal('var(--color-bg)', '#ffffff', probe, ctx);
      var scheme = background && luminance(background) < 0.5 ? 'dark' : 'light';
      var color = {};
      if (background) color.background = background;
      var ink = literal('var(--color-fg)', background, probe, ctx);
      if (ink) { color.ink = ink; color.axis = ink; }
      var muted = literal('var(--color-fg-muted)', background, probe, ctx);
      if (muted) color.inkMuted = muted;
      var line = literal('var(--color-border-line)', background, probe, ctx);
      if (line) color.grid = line;
      var series = seriesColors(scheme === 'dark')
        .map(function (value) { return literal(value, background, probe, ctx); })
        .filter(Boolean);
      if (series.length) color.series = series;
      return { scheme: scheme, theme: Object.keys(color).length ? { preset: PRESET[scheme], overrides: { color: color } } : PRESET[scheme] };
    } finally {
      probe.remove();
    }
  }

  /** The box while it waits, fails or stays empty: no text in it, and the min-height of the last drawing kept. */
  function settle(host, state) {
    host.classList.toggle('dash-skeleton', state === 'loading');
    host.replaceChildren();
    if (state !== 'error') return;
    var line = document.createElement('div');
    line.className = 'bp-failed';
    var dot = document.createElement('span');
    dot.className = 'bp-failed-dot';
    line.appendChild(dot);
    line.appendChild(document.createTextNode('Failed to load'));
    host.appendChild(line);
  }

  function rowsFor(chart, rows) {
    if (chart.columns.series) return rows;
    return rows.map(function (row) {
      var copy = {};
      for (var key in row) if (Object.prototype.hasOwnProperty.call(row, key)) copy[key] = row[key];
      copy[SERIES_KEY] = chart.seriesLabel || chart.columns.value;
      return copy;
    });
  }

  function draw(chart, index) {
    var host = document.getElementById(chart.container);
    if (!host) return;
    var result = dash.data(chart.dataset);
    var status = result && result.status;
    if (status === 'loading') { settle(host, 'loading'); return; }
    if (status === 'error') { settle(host, 'error'); return; }
    var width = host.clientWidth;
    if (!Boardplot || status !== 'ok' || !Array.isArray(result.data) || !width) { settle(host, 'empty'); return; }
    var columns = {};
    for (var role in chart.columns) columns[role] = chart.columns[role];
    if (!columns.series) columns.series = SERIES_KEY;
    var spec;
    try {
      spec = Boardplot.specFromRows(chart.spec, { rows: rowsFor(chart, result.data), columns: columns }).spec;
    } catch (error) {
      console.warn('Boardplot: the rows of ' + chart.dataset + ' do not map: ' + (error && error.message));
      settle(host, 'empty');
      return;
    }
    var picked = dashboardTheme(host);
    var options = {};
    for (var key in spec.options || {}) options[key] = spec.options[key];
    options.size = { width: width };
    options.theme = picked.theme;
    var fallback = false;
    // The findings the dashboard's colours add, for the roles this chart paints. A contrast
    // finding or an error: draw the complete preset for the scheme, which has none.
    var findings = typeof picked.theme === 'object' ? Boardplot.themeFindings(picked.theme, { type: spec.type, data: spec.data, options: options }) : [];
    findings = findings.filter(function (f) { return f.severity === 'error' || /contrast|invisible/.test(f.code); });
    if (findings.length) {
      console.warn('Boardplot: dashboard colours refused (' + findings.map(function (f) { return f.code; }).join(', ') + '); drawing in ' + PRESET[picked.scheme]);
      options.theme = PRESET[picked.scheme];
      fallback = true;
    }
    var drawn = Boardplot.render({ type: spec.type, data: spec.data, options: options }, { idScope: 'dash-' + index });
    if (!drawn.ok) {
      console.warn('Boardplot: ' + chart.dataset + ': ' + drawn.errors.map(function (e) { return e.code + ': ' + e.message; }).join('; '));
      settle(host, 'empty');
      return;
    }
    var parsed = new DOMParser().parseFromString(drawn.svg, 'image/svg+xml');
    var svg = parsed.documentElement;
    if (!svg || svg.nodeName !== 'svg' || parsed.getElementsByTagName('parsererror').length) { settle(host, 'empty'); return; }
    var node = document.importNode(svg, true);
    // The viewBox keeps the drawn proportions; the box, not the SVG, sets the width.
    node.setAttribute('width', '100%');
    node.removeAttribute('height');
    host.classList.remove('dash-skeleton');
    if (fallback) host.setAttribute('data-bp-theme', 'fallback'); else host.removeAttribute('data-bp-theme');
    host.style.minHeight = drawn.height + 'px';
    host.replaceChildren(node);
  }

  function drawAll() {
    CHARTS.forEach(draw);
  }

  dash.onData(drawAll);
  // The dashboard switches its theme with data-mode (light, dark, system); system follows the media query.
  if (window.MutationObserver) {
    new MutationObserver(drawAll).observe(document.documentElement, { subtree: true, attributes: true, attributeFilter: ['data-mode'] });
  }
  if (window.matchMedia) {
    var scheme = window.matchMedia('(prefers-color-scheme: dark)');
    if (scheme.addEventListener) scheme.addEventListener('change', drawAll);
  }
})();
