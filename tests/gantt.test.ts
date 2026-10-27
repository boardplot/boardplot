import { expect, it } from 'vitest';
import { getFixtures } from '../src/fixtures';
import { layoutResolvedRequest, resolveChartRequest } from '../src/index';
import { rectContains, rectsOverlap, segmentHitsRect } from '../src/core/geometry';
import { leaderPieces } from '../src/core/label/solver';
import type { GanttMarks } from '../src/core/charts/gantt/layout';
import { render } from '../src/cli/render';
import { callTool } from '../src/mcp/server';
import { renderSvg } from '../src/core/svg/renderSvg';

// A hidden arrow must be named once in warnings, while other missing labels stay disclosed.
it('gantt names each hidden arrow in one warning', () => {
  const fixture = getFixtures('gantt').find(f => f.id === 'two-year-span')!;
  const data = structuredClone(fixture.data) as { rows: { items: { id: string; label?: string }[] }[] };
  const name = 'An arrow name longer than the available timeline width';
  data.rows.flatMap(row => row.items).find(item => item.id === 'c-chev')!.label = name;
  for (const footnotes of [undefined, false] as const) {
    const request = resolveChartRequest({ type: 'gantt', data,
      options: { ...fixture.options, footnotes, size: { width: 300 } } });
    const geometry = layoutResolvedRequest(request);
    if (geometry.refused) throw new Error('gantt refused');
    expect(geometry.labels.find(label => label.owner.segmentId === 'c-chev')?.hidden).toBeTruthy();
    // footnotes: false names the note it left off in its own lint; that is not a second arrow warning.
    expect(geometry.warnings.filter(warning => warning.code !== 'footnotes-off' && warning.message.includes(name))).toHaveLength(1);
    expect(geometry.warnings.find(warning => warning.message.includes(name))?.code).toBe('gantt-arrow-label-hidden');
    const noted = geometry.warnings.find(warning => warning.code === 'values-in-note')?.detail?.values ?? [];
    for (const label of geometry.labels.filter(label => label.hidden && label.noted && label.owner.segmentId !== 'c-chev')) {
      expect(noted).toContain(label.noteText ?? label.text);
    }
    expect(renderSvg(geometry, request.theme)).toBe(renderSvg(layoutResolvedRequest(request) as never, request.theme));
  }
});

// A narrow arrow must keep its full name outside the arrow when a clear seat exists.
it('gantt draws a hidden arrow name outside on narrow timelines', () => {
  const fixture = getFixtures('gantt').find(f => f.id === 'two-year-span')!;
  for (const width of [300, 320, 340]) {
    const request = resolveChartRequest({ type: 'gantt', data: fixture.data,
      options: { ...fixture.options, size: { width } }, annotations: fixture.annotations });
    const geometry = layoutResolvedRequest(request);
    if (geometry.refused) throw new Error('gantt refused');
    const mark = (geometry.marks.rows as GanttMarks['rows']).flatMap(row => row.itemNodes).find(mark => mark.id === 'c-chev')!;
    const label = geometry.labels.find(label => label.owner.segmentId === mark.id && !label.hidden)!;
    expect(label?.text, `${width}px`).toBe('Run-rate');
    expect(label.lines).toEqual(['Run-rate']);
    expect(rectsOverlap(label.rect, mark.rect)).toBe(false);
    for (const other of geometry.labels.filter(other => other !== label && !other.hidden)) {
      expect(rectsOverlap(label.rect, other.rect), other.id).toBe(false);
    }
    expect(renderSvg(geometry, request.theme)).toBe(renderSvg(layoutResolvedRequest(request) as never, request.theme));
  }
  const data = structuredClone(fixture.data) as { rows: { items: { id: string; label?: string }[] }[] };
  const name = 'An arrow name longer than the available timeline width';
  data.rows.flatMap(row => row.items).find(item => item.id === 'c-chev')!.label = name;
  const cramped = layoutResolvedRequest(resolveChartRequest({ type: 'gantt', data,
    options: { ...fixture.options, size: { width: 300 } } }));
  if (!cramped.refused) expect(cramped.warnings.some(warning => warning.severity === 'warn' && warning.message.includes(name))).toBe(true);
});

// An arrow name seated past the next arrow and its name reads as the wrong arrow's name.
it('gantt never seats an arrow name past another arrow in its row', () => {
  const data = { rows: [{ id: 'p', label: 'Stream one', items: [
    { id: 'discovery', kind: 'chevron', start: '2026-01-05', end: '2026-02-20', label: 'Discovery sprint' },
    { id: 'gate', kind: 'milestone', start: '2026-03-02', label: 'Kickoff gate' }] },
  { id: 'r', label: 'Stream two', items: [
    { id: 'pilot', kind: 'chevron', start: '2026-02-01', end: '2026-03-10', label: 'Pilot rollout wave' },
    { id: 'scale', kind: 'chevron', start: '2026-03-12', end: '2026-04-20', label: 'Scale' }] },
  { id: 'q', label: 'Stream three', items: [{ id: 'hiring', kind: 'bar', start: '2026-01-10', end: '2026-01-30', label: 'Hiring plan' },
    { id: 'handover', kind: 'chevron', start: '2026-05-01', end: '2026-06-15', label: 'Hand-over to operations' }] }] };
  const geometry = layoutResolvedRequest(resolveChartRequest({ type: 'gantt', data, options: { size: { width: 320 } } }));
  if (geometry.refused) throw new Error('gantt refused');
  const marks = (geometry.marks.rows as GanttMarks['rows']).flatMap(row => row.itemNodes);
  const scale = marks.find(mark => mark.id === 'scale')!.rect;
  const label = geometry.labels.find(label => label.owner.segmentId === 'pilot')!;
  if (label.hidden) expect(geometry.warnings.some(warning => warning.message.includes('Pilot rollout wave'))).toBe(true);
  else expect(label.rect.x + label.rect.w).toBeLessThanOrEqual(scale.x);
});

// One arrow name with no seat anywhere must not undo the seat repair of the other names.
it('gantt keeps other name repairs when one arrow name has no seat', () => {
  const fixture = getFixtures('gantt').find(f => f.id === 'milestone-lane-tall-rows')!;
  const options = { ...fixture.options, theme: 'boardroom', target: 'dashboard', size: { width: 900 } };
  const seat = (data: object) => {
    const geometry = layoutResolvedRequest(resolveChartRequest({ type: 'gantt', data, options }));
    if (geometry.refused) throw new Error('gantt refused');
    return geometry.labels.find(label => label.id === 'item:discovery:discovery-bar')!.rect;
  };
  const data = structuredClone(fixture.data) as { rows: object[] };
  data.rows.push({ id: 'extra', label: 'Extra', items: [{ id: 'long', kind: 'chevron', start: '2026-02-01', end: '2026-03-01',
    label: 'Impossible name '.repeat(30).trim() }] });
  expect(seat(data)).toEqual(seat(fixture.data));
});

// An arrow name that fits inside the drawn shape must not move outside with a halo.
it('gantt keeps a fitting arrow name inside and clear of its sloped edge', () => {
  const fixture = getFixtures('gantt').find(f => f.id === 'two-year-span')!;
  const geometry = layoutResolvedRequest(resolveChartRequest({ type: 'gantt', data: fixture.data,
    options: { ...fixture.options, size: { width: 400 } }, annotations: fixture.annotations }));
  if (geometry.refused) throw new Error('gantt refused');
  const mark = (geometry.marks.rows as GanttMarks['rows']).flatMap(row => row.itemNodes).find(mark => mark.id === 'c-chev')!;
  const label = geometry.labels.find(label => label.owner.segmentId === mark.id && !label.hidden)!;
  expect(label?.text).toBe('Run-rate');
  expect(rectContains(mark.rect, label.rect)).toBe(true);
  expect(label.slot).toMatch(/^inside/);
  expect(label.halo).toBeFalsy();
  const { x, y, w, h } = mark.rect;
  const tip = Math.min(9, h * 0.6, w);
  for (const [a, b] of [[{ x: x + w - tip, y }, { x: x + w, y: y + h / 2 }],
    [{ x: x + w, y: y + h / 2 }, { x: x + w - tip, y: y + h }]]) {
    expect(segmentHitsRect(a!, b!, label.rect, 1)).toBe(false);
  }
});

// Two outside names on one row must not read as one label in a short dashboard card.
it('gantt separates the span name from a milestone name on a fixed card', () => {
  const fixture = getFixtures('gantt').find(f => f.id === 'milestone-lane-tall-rows')!;
  const geometry = layoutResolvedRequest(resolveChartRequest({ type: 'gantt', data: fixture.data,
    options: { ...fixture.options, target: 'dashboard', size: { width: 960, height: 300 } }, annotations: fixture.annotations }));
  if (geometry.refused) throw new Error('gantt refused');
  const name = geometry.labels.find(label => label.owner.segmentId === 'discovery-bar' && !label.hidden)!;
  const milestone = geometry.labels.find(label => label.text === 'Readout · 27 Jan' && !label.hidden)!;
  expect(name?.text).toBe('Discovery');
  expect(milestone).toBeDefined();
  expect(rectsOverlap(name.rect, milestone.rect, 10)).toBe(false);
});

// A today rule must leave visible air beside the full bar name on a narrow timeline.
it('gantt breaks the today rule around a bar name', () => {
  const fixture = getFixtures('gantt').find(f => f.id === 'transformation-program')!;
  const geometry = layoutResolvedRequest(resolveChartRequest({ type: 'gantt', data: fixture.data,
    options: { ...fixture.options, size: { width: 320 } }, annotations: fixture.annotations }));
  if (geometry.refused) throw new Error('gantt refused');
  const label = geometry.labels.find(label => label.text === 'Wave 1' && !label.hidden)!;
  expect(label).toBeDefined();
  const rules = geometry.scene.filter(node => node.part === 'todayLine');
  expect(rules.length).toBeGreaterThan(0);
  for (const rule of rules) {
    const pieces = rule.t === 'line' ? [[{ x: rule.x1, y: rule.y1 }, { x: rule.x2, y: rule.y2 }]] : rule.t === 'path'
      ? [...rule.d.matchAll(/M([\d.-]+) ([\d.-]+)L([\d.-]+) ([\d.-]+)/g)].map(match =>
        [{ x: Number(match[1]), y: Number(match[2]) }, { x: Number(match[3]), y: Number(match[4]) }]) : [];
    expect(pieces.length).toBeGreaterThan(0);
    for (const [a, b] of pieces) expect(segmentHitsRect(a!, b!, { ...label.rect, x: label.rect.x - 6, w: label.rect.w + 12 })).toBe(false);
  }
});

// A bar name must clear milestone diamonds and the chevron tip without taking a milestone's label seat.
it('gantt keeps the bar name clear of diamonds and the arrow tip', () => {
  const fixture = getFixtures('gantt').find(f => f.id === 'milestone-lane-tall-rows')!;
  for (const theme of ['boardroom', 'standard-dark']) {
    const geometry = layoutResolvedRequest(resolveChartRequest({ type: 'gantt', data: fixture.data,
      options: { ...fixture.options, theme, size: { width: 900 } }, annotations: fixture.annotations }));
    if (geometry.refused) throw new Error('gantt refused');
    const row = (geometry.marks.rows as GanttMarks['rows']).find(row => row.id === 'discovery')!;
    const bar = row.itemNodes.find(mark => mark.id === 'discovery-bar')!;
    const label = geometry.labels.find(label => label.owner.segmentId === bar.id && !label.hidden)!;
    expect(label).toBeDefined();
    const tip = Math.min(9, bar.rect.h * 0.6, bar.rect.w);
    const blockers = [...row.itemNodes.filter(mark => mark.kind === 'milestone').map(mark => mark.rect),
      { ...bar.rect, x: bar.rect.x + bar.rect.w - tip, w: tip }];
    const padded = { x: label.rect.x - 2, y: label.rect.y - 2, w: label.rect.w + 4, h: label.rect.h + 4 };
    for (const blocker of blockers) expect(rectsOverlap(padded, blocker)).toBe(false);
    const milestones = (geometry.marks.rows as GanttMarks['rows']).flatMap(row => row.itemNodes).filter(mark => mark.kind === 'milestone');
    for (const mark of milestones) {
      const label = geometry.labels.find(label => label.owner.segmentId === mark.id && !label.hidden);
      expect(label?.text, mark.id).toMatch(/ · /);
    }
  }
  for (const [id, width, names] of [
    ['status-gantt', 280, ['Design']],
    ['status-gantt', 400, ['Design', 'Draft', 'Prepare']],
    ['status-gantt', 480, ['Design', 'Draft', 'Prepare']],
    ['two-year-span', 280, ['Foundation', 'Scale-up', 'Run-rate']],
  ] as const) {
    const fixture = getFixtures('gantt').find(f => f.id === id)!;
    const geometry = layoutResolvedRequest(resolveChartRequest({ type: 'gantt', data: fixture.data,
      options: { ...fixture.options, size: { width } }, annotations: fixture.annotations }));
    if (geometry.refused) throw new Error('gantt refused');
    for (const name of names) expect(geometry.labels.find(label => label.kind === 'item' && label.text === name && !label.hidden), `${id}: ${name}`).toBeDefined();
  }
  const fixed = layoutResolvedRequest(resolveChartRequest({ type: 'gantt', data: fixture.data,
    options: { ...fixture.options, target: 'dashboard', size: { width: 400, height: 300 } }, annotations: fixture.annotations }));
  if (fixed.refused) throw new Error('fixed gantt refused');
  for (const name of ['Synthesis · 21 Jan', 'Usability test · 12 Feb']) {
    expect(fixed.labels.find(label => label.text === name && !label.hidden), name).toBeDefined();
  }
});

// Crowded milestones must keep their full labels at their diamonds, without a hidden key or a leader through another label.
it('gantt keeps crowded milestone labels beside their own diamonds', () => {
  const fixture = getFixtures('gantt').find(f => f.id === 'milestone-lane-tall-rows')!;
  const spec = { type: 'gantt', data: fixture.data, options: fixture.options };
  // Right-edge flags keep their full names on narrow rows too.
  const narrow = ['dense-milestone-leaders', 'adjacent-milestone-bands'].map(id => {
    const fixture = getFixtures('gantt').find(f => f.id === id)!;
    return { type: 'gantt', data: fixture.data, options: { ...fixture.options, size: { width: 320 } }, annotations: fixture.annotations };
  });
  for (const current of [spec, ...narrow]) {
    const geometry = layoutResolvedRequest(resolveChartRequest(current));
    expect(geometry.refused).toBeFalsy();
    if (geometry.refused) throw new Error('gantt refused');
    const marks = (geometry.marks.rows as GanttMarks['rows']).flatMap(row => row.itemNodes).filter(mark => mark.kind === 'milestone');
    const visible = geometry.labels.filter(label => !label.hidden);
    for (const mark of marks) {
      const label = visible.find(label => label.owner.segmentId === mark.id)!;
      expect(label, mark.id).toBeDefined();
      expect(label.text).toMatch(/ · /);
      const cx = mark.rect.x + mark.rect.w / 2;
      // A label without a leader sits right above or below its own diamond.
      if (!label.leader) expect(Math.max(label.rect.y - mark.rect.y - mark.rect.h, mark.rect.y - label.rect.y - label.rect.h), mark.id).toBeLessThanOrEqual(12);
      expect(label.rect.x <= cx && label.rect.x + label.rect.w >= cx, mark.id).toBe(true);
      for (const other of visible.filter(other => other !== label)) {
        expect(rectsOverlap(label.rect, other.rect), `${mark.id} overlaps ${other.id}`).toBe(false);
        for (const [a, b] of label.leader ? leaderPieces(label.leader.d, 64) : []) {
          expect(segmentHitsRect(a, b, other.rect), `${mark.id} crosses ${other.id}`).toBe(false);
        }
      }
      for (const other of marks.filter(other => other !== mark)) {
        for (const [a, b] of label.leader ? leaderPieces(label.leader.d, 64) : []) {
          expect(segmentHitsRect(a, b, other.rect), `${mark.id} crosses ${other.id}`).toBe(false);
        }
      }
    }
  }
  const input = { spec, return: ['svg', 'reading'] };
  expect(callTool('boardplot_render', input).structuredContent).toMatchObject(render(input).body);
  // A flag retry on a fixed canvas must not remove a bar name that the first pass could place.
  const status = getFixtures('gantt').find(f => f.id === 'status-gantt')!;
  const fixed = layoutResolvedRequest(resolveChartRequest({ type: 'gantt', data: status.data,
    options: { ...status.options, size: { width: 400, height: 600 } } }));
  if (fixed.refused) throw new Error('fixed gantt refused');
  expect(fixed.labels.find(label => label.text === 'Draft' && !label.hidden)).toBeDefined();
});

// labelDensity: 'minimal' hides milestone labels on request, so the flag retry must not add empty rows.
it('gantt minimal density does not take the height of milestone flags', () => {
  const fixture = getFixtures('gantt').find(f => f.id === 'milestone-lane-tall-rows')!;
  const layout = (labelDensity: 'smart' | 'minimal') => layoutResolvedRequest(resolveChartRequest({ type: 'gantt', data: fixture.data,
    options: { ...fixture.options, labelDensity, size: { width: 900 } } }));
  const minimal = layout('minimal');
  if (minimal.refused) throw new Error('minimal gantt refused');
  expect(minimal.labels.filter(label => label.kind === 'item' && !label.hidden)).toHaveLength(0);
  expect(minimal.size.height).toBeLessThan(layout('smart').size.height);
});

// An event at an item id marks the boundary where that item starts; a mid-day rule sat half a day inside the new span.
it('gantt draws an event rule at an item id on the item start edge, and through a milestone diamond', () => {
  const geometry = layoutResolvedRequest(resolveChartRequest({ type: 'gantt', data: { rows: [
    { id: 'a', label: 'A', items: [{ id: 'a1', kind: 'bar', start: '2026-03-02', end: '2026-03-09' }, { id: 'a2', kind: 'bar', start: '2026-03-10', end: '2026-03-31' }] },
    { id: 'b', label: 'B', items: [{ id: 'b1', kind: 'milestone', start: '2026-03-20' }] }] },
    options: { size: { width: 1000 } },
    annotations: [{ id: 'e', kind: 'event', at: 'a2', label: 'Change' }, { id: 'm', kind: 'event', at: 'b1', label: 'Gate' }] }));
  if (geometry.refused) throw new Error('gantt refused');
  const node = (id: string) => geometry.scene.find(n => n.id === id)!;
  // Rules turn into dash paths once labels cut them; a path's x values are its 'M'/'L' coordinates.
  const xs = (n: unknown) => 'x1' in (n as object) ? [(n as { x1: number }).x1] : [...(n as { d: string }).d.matchAll(/[ML](-?[\d.]+) /g)].map(m => Number(m[1]));
  const bar = node('mark:a:a2') as { rect: { x: number } };
  expect(xs(node('ann:event:e:line'))[0]).toBeCloseTo(bar.rect.x, 1);
  const diamond = xs(node('mark:b:b1'));
  expect(xs(node('ann:event:m:line'))[0]).toBeCloseTo((Math.min(...diamond) + Math.max(...diamond)) / 2, 1);
});

// Event rules hid a long arrow name below 1,800 px; the name now draws and the rules break around it.
it('gantt draws a long arrow name across two event rules, and no rule piece runs through it', () => {
  const geometry = layoutResolvedRequest(resolveChartRequest({ type: 'gantt', data: { rows: [
    { id: 'a', label: 'A', items: [{ id: 'a1', kind: 'chevron', start: '2026-03-02', end: '2026-03-31', label: 'A long arrow name that runs across both change rules of this row' }] },
    { id: 'b', label: 'B', items: [{ id: 'b1', kind: 'bar', start: '2026-03-02', end: '2026-03-12' }, { id: 'b2', kind: 'bar', start: '2026-03-13', end: '2026-03-20' }] }] },
    options: { size: { width: 800 } },
    annotations: [{ id: 'e1', kind: 'event', at: 'b2', label: 'One' }, { id: 'e2', kind: 'event', at: '2026-03-21', label: 'Two' }] }));
  if (geometry.refused) throw new Error('gantt refused');
  const label = geometry.labels.find(l => l.owner.segmentId === 'a1')!;
  expect(label.hidden).toBeFalsy();
  expect(geometry.warnings.map(w => w.code)).not.toContain('gantt-arrow-label-hidden');
  const pieces = geometry.scene.filter(n => n.part === 'eventRule').flatMap(n => n.t === 'line' ? [[n.x1, n.y1, n.y2]]
    : n.t === 'path' ? [...n.d.matchAll(/M(-?[\d.]+) (-?[\d.]+)L-?[\d.]+ (-?[\d.]+)/g)].map(m => [+m[1]!, +m[2]!, +m[3]!]) : []);
  const { x, y, w, h } = label.rect;
  expect(pieces.filter(([px]) => px! >= x && px! <= x + w).length).toBeGreaterThan(0);
  expect(pieces.filter(([px, y1, y2]) => px! >= x && px! <= x + w && Math.max(y1!, y2!) > y && Math.min(y1!, y2!) < y + h)).toEqual([]);
});

// A wrapped two-line name plus a sublabel is taller than the common row pitch: the row must grow, not hide the sublabel.
it('gantt grows a table row whose wrapped name and sublabel need more than the row pitch', () => {
  const fixture = getFixtures('gantt').find(f => f.id === 'status-gantt')!;
  const data = { ...fixture.data, rows: fixture.data.rows.map(row => ({ ...row, sublabel: 'PMO' })) } as typeof fixture.data;
  const geometry = layoutResolvedRequest(resolveChartRequest({ type: 'gantt', data, options: { ...fixture.options, size: { width: 480 } }, annotations: fixture.annotations }));
  if (geometry.refused) throw new Error('gantt refused');
  const wrapped = geometry.labels.find(label => label.id === 'activity:interview-prep')!;
  expect(wrapped.lines).toHaveLength(2);
  expect(geometry.labels.filter(label => label.id.startsWith('sublabel:') && label.hidden)).toEqual([]);
});
