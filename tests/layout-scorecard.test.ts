import { expect, it } from 'vitest';
import { getFixtures } from '../src/fixtures';
import { getChartDefinition, measure } from '../src/index';
import { autoPlotShare } from '../src/core/sizing';

// @ts-expect-error The scorecard is a JavaScript script without declarations.
import { auditHeight, auditGeometry, auditScene, auditRepairs, applyRepair, compareOutcomes, outcomes, outcomeShard, repairFixture, visibleTextHash } from '../scripts/layout-scorecard.mjs';
// @ts-expect-error The list is a JavaScript module without declarations.
import { REPAIRS } from '../scripts/layout-scorecard-repairs.mjs';

// An appended story must not create a plot-share failure or hide a genuinely small plot.
it('excludes only an automatic below-chart story from the S1 denominator', () => {
  const fixture = getFixtures('scatter').find(item => item.id === 'story-use-case-matrix')!;
  for (const theme of ['boardroom', 'notation'] as const) {
    const request = { type: 'scatter', data: fixture.data, options: { ...fixture.options, theme, size: { width: 480, height: undefined as number | undefined } } };
    const geometry = measure(request).geometry!;
    const item = { fixture: 'scatter/story-use-case-matrix', width: 480, theme, height: 'auto' };
    const s1 = (geo = geometry, spec = request) => auditGeometry(item, spec, geo).filter((finding: { rule: string }) => finding.rule === 'S1');
    expect(geometry.story?.placement).toBe('below');
    expect(s1()).toEqual([]);
    for (const h of [159, 200]) expect(s1({ ...geometry, plot: { ...geometry.plot, h } })).toHaveLength(1);
    // A plot over the share floor of the canvas without the story, and under it of the whole canvas,
    // passes only for an automatic height with the story below.
    const shareFloor = autoPlotShare(getChartDefinition('scatter')!, { ...request.options, target: 'report' }, 480);
    const between = { ...geometry, plot: { ...geometry.plot, h: shareFloor * (geometry.size.height - geometry.story!.panel.h / 2) } };
    expect(s1(between)).toEqual([]);
    expect(s1({ ...between, story: { ...geometry.story!, placement: 'right' } })).toHaveLength(1);
    expect(s1(between, { ...request, options: { ...request.options, size: { width: 480, height: geometry.size.height } } })).toHaveLength(1);
    expect(auditGeometry(item, { ...request, options: { ...request.options, title: 'Missing title' } }, geometry)
      .some((finding: { rule: string }) => finding.rule === 'S3')).toBe(true);
  }
});

const sample = () => {
  const fixture = getFixtures('line')[0]!;
  return { type: 'line', data: fixture.data, options: { ...fixture.options, size: { width: 400 } } };
};
const caseItem = { fixture: 'line/check', width: 400, theme: 'authored', height: 'auto', setting: 'default' };

// Reference paths keep two decimals, so a label seated on the 3 px floor must not read as too close.
it('allows path rounding in the reference clearance and keeps a real shortfall', () => {
  const geometry = measure(sample()).geometry!;
  const label = geometry.labels.find(entry => !entry.hidden && geometry.scene.some(node => node.id === entry.nodeId))!;
  const r1 = (gap: number) => {
    const y = label.rect.y - gap;
    const scene = [...geometry.scene.filter(node => node.id === label.nodeId),
      { t: 'path', id: 'ref', part: 'reference', d: `M${label.rect.x} ${y}L${label.rect.x + label.rect.w} ${y}` }];
    return auditGeometry(caseItem, sample(), { ...geometry, scene, labels: [label] } as never)
      .filter((f: { rule: string }) => f.rule === 'R1');
  };
  expect(r1(2.995)).toEqual([]);
  expect(r1(2.98)).toHaveLength(1);
});

// The frame draws a bold title or subtitle without its ** markers; the authored text must match the drawn text.
it('compares a bold title and subtitle without their markers', () => {
  for (const subtitle of ['**Revenue** in EUR m', { measure: '**Revenue**', period: '2025' }]) {
    const request = { type: 'column', data: { categories: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }], series: [{ id: 'v', label: 'Revenue', values: [1, 2] }] },
      options: { title: '**Revenue** by year', subtitle, unit: 'EUR m', size: { width: 480 } } };
    expect(auditGeometry(caseItem, request, measure(request as never).geometry!).filter((f: { rule: string }) => f.rule === 'S3')).toEqual([]);
  }
});

// Table cards may shrink at a narrower width; chart families that retain the height floor still fail S2.
it('checks height ordering only for chart types that retain the wider-card floor', () => {
  const geometry = { size: { height: 200 } };
  const wider = { width: 480, height: 240 };
  for (const type of ['table', 'dimswitch']) expect(auditHeight({ ...caseItem, fixture: type + '/check' }, geometry, wider)).toEqual([]);
  expect(auditHeight(caseItem, geometry, wider).map((finding: { rule: string }) => finding.rule)).toEqual(['S2']);
});
const textNode = (id: string, x = 30, y = 30, extra = {}) => ({ t: 'text', id, x, y, lines: ['Label'], font: { family: 'Arial', size: 14, weight: 400 }, fill: { token: 'ink' }, ...extra });
const sceneFindings = (scene: unknown[], labels: unknown[] = [], decisions: unknown[] = [], omissions: unknown[] = []) => auditScene(caseItem, sample(), {
  size: { width: 400, height: 200 }, plot: { x: 0, y: 0, w: 400, h: 200 }, scene, labels, debug: { decisions },
}, { omissions });

// A published fix must produce a drawing and remove the warning it claims to fix.
it('checks refusal repairs and persistent warning fixes on the repaired request', () => {
  const request = sample();
  const measured = measure(request);
  const warning = { code: 'check-warning', fix: [{ op: 'add', path: '/options/title', value: 'Repaired' }] };
  expect(auditRepairs(caseItem, request, { ...measured, warnings: [warning] })).toEqual([]);
  const bad = { ...warning, fix: [{ op: 'add', path: '/options/size', value: { width: 1, height: 1 } }] };
  expect(auditRepairs(caseItem, request, { ...measured, warnings: [bad] })[0].rule).toBe('R4');
  const data = structuredClone(request.data);
  for (const series of data.series) series.values = series.values.map((value: unknown) => typeof value === 'number' ? value * 1_000_000 : value);
  const warnedRequest = { ...request, data, options: { ...request.options, format: '0' } };
  const warned = measure(warnedRequest);
  const real = warned.warnings[0]!;
  expect(real).toBeDefined();
  const noChange = { ...real, fix: [{ op: 'add', path: '/options/size', value: request.options.size }] };
  expect(auditRepairs(caseItem, warnedRequest, { ...warned, warnings: [noChange] })[0].message).toContain('remains');
  expect(applyRepair({ 'a/b': [1] }, [{ op: 'add', path: '/a~1b/-', value: 2 }, { op: 'test', path: '/a~1b/0', value: 1 }, { op: 'remove', path: '/a~1b/0' }])).toEqual({ 'a/b': [2] });
});

// Warnings with no `field` share a key per code: a correct patch for one read as "warning remains" while its sibling stayed.
it('does not read a fixed warning as remaining while another warning of its code stays', () => {
  const fixture = getFixtures('table')[0]!;
  const request = { type: 'table', data: fixture.data, options: { ...fixture.options, valueAxis: { show: false }, labelDensity: 'full', size: { width: 720 } }, annotations: [] };
  const measured = measure(request);
  expect(measured.warnings.filter((warning: { code: string; field?: unknown }) => warning.code === 'option-ignored' && !warning.field)).toHaveLength(2);
  expect(auditRepairs(caseItem, request, measured)).toEqual([]);
});

// A repair entry whose setting stops producing a patch (a fixture or a warning changed) would pass R4 with nothing to check.
it('keeps every repair entry producing a warning or refusal with a patch', () => {
  const stale: string[] = [];
  for (const entry of REPAIRS) {
    const fixture = repairFixture(entry);
    const request = { type: entry.type, data: fixture.data, options: { ...fixture.options, size: { width: entry.widths?.[0] ?? 720 } }, annotations: fixture.annotations ?? fixture.options.annotations ?? [] };
    let fixes: unknown[];
    try {
      const measured = measure(request);
      fixes = (measured.refused?.warnings ?? measured.warnings).filter((warning: { fix?: unknown[] }) => warning.fix?.length);
    } catch (error) {
      fixes = (error as { fix?: unknown[] }).fix?.length ? [error] : [];
    }
    if (fixes.length === 0) stale.push(entry.name);
  }
  expect(stale).toEqual([]);
}, 60_000);

// Text from different scene parts can collide or leave the canvas outside the label solver.
it('checks all visible text, including translated and rotated text, without counting blank space', () => {
  expect(sceneFindings([textNode('a'), textNode('b', 20, 30, { tx: 10 })]).filter((f: { rule: string }) => f.rule === 'R5')).toHaveLength(1);
  expect(sceneFindings([textNode('a', -20, 1, { rotate: 90 })]).some((f: { subject: string }) => f.subject.endsWith('/ canvas'))).toBe(true);
  expect(sceneFindings([textNode('a', 30, 30, { lines: ['A             Z'] }), textNode('b', 60, 30, { lines: ['B'] })])).toEqual([]);
  expect(sceneFindings([textNode('a'), textNode('hidden', 30, 30, { opacity: 0 })])).toEqual([]);
  const fixture = getFixtures('column').find(fixture => fixture.id === 'anomaly-torture')!;
  const request = { type: 'column', data: fixture.data, options: { ...fixture.options, size: { width: 320 } } };
  expect(auditScene(caseItem, request, measure(request).geometry!, { omissions: [] }).filter((f: { rule: string }) => f.rule === 'R5')).toEqual([]);
});

// A crossing is safe only when a later halo or opaque plate hides the stroke under the text.
it('checks line parts against text in paint order, including curved and closed paths', () => {
  const line = { t: 'path', id: 'connector', part: 'connector', d: 'M20 37 q20 0 80 0 z', stroke: { token: 'ink' }, width: 1 };
  const label = textNode('label');
  const gapLabel = textNode('gap-label', 22, 30, { lines: ['I'] });
  const dashed = { t: 'line', id: 'dashed', x1: 0, y1: 37, x2: 80, y2: 37, stroke: { token: 'ink' }, width: 1, dash: [4, 36] };
  const dashPath = { ...line, id: 'dash-path', d: 'M0 37 L20 37 L80 37', dash: [4, 36] };
  // L and flattened curves keep their dash phase; a caption in a gap must pass.
  expect(sceneFindings([dashed, dashPath, gapLabel]).filter((f: { rule: string }) => f.rule === 'R6')).toEqual([]);
  expect(sceneFindings([{ ...dashPath, d: 'M0 37 C10 37 15 37 20 37 L80 37' }, gapLabel]).filter((f: { rule: string }) => f.rule === 'R6')).toEqual([]);
  expect(sceneFindings([{ ...dashPath, d: 'M0 37 L20 37 M22 37 L80 37' }, gapLabel]).filter((f: { rule: string }) => f.rule === 'R6')).toHaveLength(1);
  const smallLabel = textNode('small', 4.1, 35, { lines: ['I'], font: { family: 'Arial', size: 4, weight: 400 } });
  expect(sceneFindings([dashed, smallLabel]).filter((f: { rule: string }) => f.rule === 'R6')).toEqual([]);
  for (const lineCap of ['round', 'square']) expect(sceneFindings([{ ...dashed, lineCap }, smallLabel]).filter((f: { rule: string }) => f.rule === 'R6')).toHaveLength(1);
  expect(sceneFindings([{ ...dashed, dash: [4] }, { ...smallLabel, x: 5 }]).filter((f: { rule: string }) => f.rule === 'R6')).toEqual([]);
  expect(sceneFindings([{ ...dashed, dash: [0, 40], lineCap: 'round' }, { ...smallLabel, x: 0.1 }]).filter((f: { rule: string }) => f.rule === 'R6')).toHaveLength(1);
  expect(sceneFindings([{ ...dashed, dash: [0, 0] }, gapLabel]).filter((f: { rule: string }) => f.rule === 'R6')).toHaveLength(1);
  for (const css of ['none', 'transparent', '#0000', '#00000000', 'rgba(0, 0, 0, 0)', 'rgba(0, 0, 0, 0%)']) {
    expect(sceneFindings([{ ...line, stroke: { css } }, label]).filter((f: { rule: string }) => f.rule === 'R6')).toEqual([]);
  }
  for (const patch of [{ opacity: 0 }, { width: 0 }, { stroke: undefined }]) expect(sceneFindings([{ ...line, ...patch }, label]).filter((f: { rule: string }) => f.rule === 'R6')).toEqual([]);
  const nearLine = { ...dashed, dash: undefined, y1: 30, y2: 30 };
  expect(sceneFindings([nearLine, gapLabel]).filter((f: { rule: string }) => f.rule === 'R6')).toEqual([]);
  expect(sceneFindings([{ ...nearLine, width: 6 }, gapLabel]).filter((f: { rule: string }) => f.rule === 'R6')).toHaveLength(1);
  expect(sceneFindings([line, label]).filter((f: { rule: string }) => f.rule === 'R6')).toHaveLength(1);
  expect(sceneFindings([line, { ...label, halo: true }])).toEqual([]);
  expect(sceneFindings([{ ...label, halo: true }, line]).filter((f: { rule: string }) => f.rule === 'R6')).toHaveLength(1);
  expect(sceneFindings([line, { t: 'rect', id: 'plate', rect: { x: 20, y: 20, w: 100, h: 35 }, fill: { token: 'background' } }, label])).toEqual([]);
  for (const css of ['#fff', '#ffff', '#ffffffff', 'white', 'rgb(255, 255, 255)', 'rgb(100%, 100%, 100%)', 'rgba(255, 255, 255, 1)', 'rgba(255, 255, 255, 100%)']) {
    expect(sceneFindings([line, { t: 'rect', id: 'plate', rect: { x: 20, y: 20, w: 100, h: 35 }, fill: { css } }, label])).toEqual([]);
  }
  for (const css of ['#fffe', '#fffffffe', 'rgba(255, 255, 255, 0.92)', 'rgba(255, 255, 255, 99%)', 'transparent']) {
    expect(sceneFindings([line, { t: 'rect', id: 'plate', rect: { x: 20, y: 20, w: 100, h: 35 }, fill: { css } }, label]).filter((f: { rule: string }) => f.rule === 'R6')).toHaveLength(1);
  }
});

// A solver request that disappears must remain visible to the caller in reading.omissions.
it('reports requested labels without drawn text or an omission record', () => {
  const labels = [{ id: 'a', nodeId: 'drawn-a' }, { id: 'b', hidden: true }, { id: 'c' }];
  expect(sceneFindings([textNode('drawn-a')], labels, [{ labelId: 'c' }], [{ labelId: 'b' }]).map((f: { rule: string; subject: string }) => [f.rule, f.subject])).toEqual([['R7', 'c']]);
  expect(sceneFindings([textNode('label:c')], labels, [{ labelId: 'c' }], [{ labelId: 'a' }, { labelId: 'b' }])).toEqual([]);
  expect(sceneFindings([], [], [{ labelId: 'missing-request' }]).map((f: { subject: string }) => f.subject)).toEqual(['missing-request']);
  const line = measure(sample()).geometry!;
  expect(auditScene(caseItem, sample(), line, { omissions: line.labels.filter(label => label.hidden).map(label => ({ labelId: label.id })) }).filter((f: { rule: string }) => f.rule === 'R7')).toEqual([]);
  const fixture = getFixtures('histogram')[0]!;
  const request = { type: 'histogram', data: fixture.data, options: { ...fixture.options, size: { width: 400 } } };
  const geometry = measure(request).geometry!;
  const omissions = geometry.labels.filter(label => label.hidden).map(label => ({ labelId: label.id }));
  expect(auditScene(caseItem, request, geometry, { omissions }).filter((f: { rule: string }) => f.rule === 'R7')).toEqual([]);
});

// A narrow-card label loss must fail the gate even when goldens and label positions do not change.
it('compares visible content, geometry and finding subjects, including removed cases in a shard', () => {
  const item = { fixture: 'line/card', width: 320, theme: 'authored', setting: 'default', status: 'drawn',
    canvas: { width: 320, height: 240 }, plot: { x: 20.1, y: 40, w: 260, h: 180 }, text: 'before' };
  const baseline = outcomes({ cases: [item], findings: [{ ...item, rule: 'R2', subject: 'a / b', message: 'gap 1 px' }] });
  const same = outcomes({ cases: [{ ...item, plot: { ...item.plot, x: 20.2 } }], findings: [{ ...item, rule: 'R2', subject: 'a / b', message: 'gap 2 px' }] });
  expect(compareOutcomes(same, baseline)).toEqual([]);
  for (const change of [{ text: 'after' }, { status: 'refused', codes: ['size-below-floor'] }, { canvas: { width: 320, height: 241 } }, { plot: { ...item.plot, x: 21 } }]) {
    expect(compareOutcomes(outcomes({ cases: [{ ...item, ...change }], findings: [] }), baseline)[0].key).toContain('line/card');
  }
  expect(compareOutcomes(outcomes({ cases: [item], findings: [{ ...item, rule: 'R2', subject: 'a / c' }] }), baseline)).toHaveLength(1);
  const job = Math.floor(outcomeShard(item, 6) / 2) + 1;
  expect(compareOutcomes([], baseline, job, 3)).toHaveLength(1);
  expect(compareOutcomes([], baseline, job % 3 + 1, 3)).toEqual([]);
  expect(compareOutcomes(baseline, [])).toHaveLength(1);
  const text = (lines: string[], x = 0, opacity = 1) => ({ t: 'text', lines, x, opacity });
  const hash = (scene: unknown[]) => visibleTextHash({ scene });
  expect(hash([text(['A', 'B']), text(['C'])])).toBe(hash([text(['C'], 20), text(['A B'], 10)]));
  expect(hash([text(['A']), text(['hidden'], 0, 0)])).toBe(hash([text(['A'])]));
  expect(hash([text(['A']), text(['A'])])).not.toBe(hash([text(['A'])]));
});
