import { expect, it } from 'vitest';
import { getFixtures } from '../src/fixtures';
import { layoutResolvedRequest, resolveChartRequest } from '../src/index';
import { rectContains, rectsOverlap, segmentHitsRect } from '../src/core/geometry';
import { leaderPieces } from '../src/core/label/solver';
import type { GanttMarks } from '../src/core/charts/gantt/layout';
import type { Annotation } from '../src/core/types/annotations';
import { render } from '../src/cli/render';
import { callTool } from '../src/mcp/server';
import { defaultMeasurer } from '../src/core/text';
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
  const data = { ...(fixture.data as object), rows: (fixture.data as { rows: object[] }).rows.map((row) => ({ ...row, sublabel: 'PMO' })) };
  const geometry = layoutResolvedRequest(resolveChartRequest({ type: 'gantt', data, options: { ...fixture.options, size: { width: 480 } }, annotations: fixture.annotations }));
  if (geometry.refused) throw new Error('gantt refused');
  const wrapped = geometry.labels.find(label => label.id === 'activity:interview-prep')!;
  expect(wrapped.lines).toHaveLength(2);
  expect(geometry.labels.filter(label => label.id.startsWith('sublabel:') && label.hidden)).toEqual([]);
});

// A badge took the seat of a numbered ring or an event name, and both labels vanished; without labels its strip still took height; its label was white on any fill.
it('gantt badges keep every marker label, take no height without annotation labels, and pick their ink against their fill', () => {
  const data = { rows: [{ id: 'a', label: 'Alpha', items: [{ id: 'a1', kind: 'bar', label: 'Work', start: '2026-01-02', end: '2026-01-28' }] }] };
  const event = (at: string, label: string, badge = false): Annotation => ({ kind: 'event', at, label, tone: 'bad', ...(badge ? { labelPlacement: 'badge' as const } : {}) });
  const layout = (annotations: Annotation[], labels?: object) => {
    const geometry = layoutResolvedRequest(resolveChartRequest({ type: 'gantt', data, options: { size: { width: 600 }, theme: 'standard', ...(labels ? { labels } : {}) }, annotations }));
    if (geometry.refused) throw new Error('gantt refused');
    return geometry;
  };
  const ordinary = [event('2026-01-11', 'Go'), event('2026-01-15', 'Two'), event('2026-01-20', 'Three'), event('2026-01-25', 'Four')];
  const mixed = layout([event('2026-01-10', 'ABC', true), ...ordinary]);
  expect(mixed.labels.filter(label => label.id.startsWith('event:') && label.hidden)).toEqual([]);
  const badgeText = mixed.scene.flatMap(node => node.t === 'text' && node.id === 'label:event:event-1' ? [node] : []);
  expect(badgeText[0]?.ink).toEqual({ token: 'ink', theme: { kind: 'contrast-ink', fill: { token: 'bad' } } });
  const sameDay = Array.from({ length: 10 }, (_, i) => event('2026-01-10', String(i + 1), true));
  expect(layout(sameDay, { annotation: false }).sizing?.naturalHeight).toBe(layout([]).sizing?.naturalHeight);
});

// A data span must end at the last item end or today, not at a week edge, or arrows stop short of the edge.
it('gantt calendar span data runs from the first item to the later of the last end and today', () => {
  const data = { rows: [{ id: 'a', label: 'A', items: [{ id: 'x', kind: 'bar' as const, start: '2026-03-04', end: '2026-03-18' }] }] };
  const span = (options: object) => {
    const geometry = layoutResolvedRequest(resolveChartRequest({ type: 'gantt', data, options: { size: { width: 600 }, ...options } }));
    if (geometry.refused) throw new Error('gantt refused');
    return (geometry.derived as { span: { start: string; end: string } }).span;
  };
  expect(span({})).toEqual({ start: '2026-03-02', end: '2026-03-22' });
  expect(span({ calendar: { span: 'data' } })).toEqual({ start: '2026-03-04', end: '2026-03-18' });
  expect(span({ calendar: { span: 'data' }, today: '2026-03-25' })).toEqual({ start: '2026-03-04', end: '2026-03-25' });
  // A data span starts on a Wednesday here: the first weekend band starts on Saturday 7 March, 3 of its 15 days in.
  const geometry = layoutResolvedRequest(resolveChartRequest({ type: 'gantt', data, options: { size: { width: 600 }, calendar: { span: 'data' }, weekends: true } }));
  if (geometry.refused) throw new Error('gantt refused');
  const edges = ['grid:edge:0', 'grid:edge:1'].map(id => geometry.scene.find(n => n.id === id)!).map(n => (n as { x1: number }).x1);
  const weekend = geometry.scene.find(n => n.part === 'weekend') as { rect: { x: number } };
  expect(weekend.rect.x).toBeCloseTo(edges[0]! + (3 / 15) * (edges[1]! - edges[0]!), 1);
  // Edge milestones two years apart at 600 px: each diamond stays inside the body, not a day's few pixels.
  const long = { rows: [{ id: 'a', label: 'A', items: [{ id: 'm1', kind: 'milestone' as const, start: '2026-01-15' }, { id: 'm2', kind: 'milestone' as const, start: '2028-01-15' }] }] };
  const wide = layoutResolvedRequest(resolveChartRequest({ type: 'gantt', data: long, options: { size: { width: 600 }, calendar: { span: 'data' } } }));
  if (wide.refused) throw new Error('gantt refused');
  const xs = wide.scene.flatMap(n => n.t === 'path' && n.part === 'milestone' ? n.d.match(/-?[\d.]+/g)!.map(Number).filter((_, i) => i % 2 === 0) : []);
  expect(Math.min(...xs)).toBeGreaterThanOrEqual(wide.plot.x);
  expect(Math.max(...xs)).toBeLessThanOrEqual(wide.plot.x + wide.plot.w);
});

// Date.UTC reads years 0-99 as 19xx, so bars dated in year 50 printed heads and a description for 1950.
it('keeps the years 0 to 99 in the calendar heads and the description', () => {
  const svg = render({ spec: { type: 'gantt', data: { rows: [{ id: 'a', label: 'Phase', items: [
    { id: 'i', label: 'Build', start: '0050-03-01', end: '0051-02-28', kind: 'bar' },
  ] }] } }, return: ['svg'] }).body.svg as string;
  expect(svg).toContain('Q2 0050');
  expect(svg).toContain('1 Mar 0050');
  expect(svg).not.toContain('195');
});

// A year cell too narrow for "2010" stayed empty, so a 20-year head showed no dates and nothing said so.
it('gantt calendar head falls back to two-digit years and warns when no date fits', () => {
  const spec = (start: string, end: string, width?: number) => ({ type: 'gantt', data: { rows: [{ id: 'r', label: 'Row', items: [
    { id: 'a', label: 'a', kind: 'bar', start, end },
  ] }] }, options: width ? { size: { width, height: 300 } } : {} });
  const codes = (r: ReturnType<typeof render>) => (r.body.warnings as { code: string }[]).map((w) => w.code);
  const long = render({ spec: spec('2010-01-01', '2029-12-31'), return: ['svg'] });
  expect(long.body.svg as string).toContain('>29<');
  expect(codes(long)).not.toContain('gantt-calendar-unlabelled');
  expect(codes(render({ spec: spec('1990-01-01', '2029-12-31', 300), return: ['svg'] }))).toContain('gantt-calendar-unlabelled');
});

// A clipped edge year printed "27" beside the four-digit "2025" and "2026" once "yy" joined the year formats.
it('gantt calendar head keeps four-digit years and leaves a clipped edge year empty', () => {
  const fixture = getFixtures('gantt').find(f => f.id === 'two-year-span')!;
  const svg = render({ spec: { type: 'gantt', data: fixture.data, options: { ...fixture.options, size: { width: 400, height: 300 } } }, return: ['svg'] }).body.svg as string;
  expect(svg).toContain('>2026<');
  expect(svg).not.toMatch(/>2[0-9]</);
});

const processRows = () => {
  const plan: [string, string, string, string?][] = [['Teaser and process letter drafted', '2026-11-02', '2026-11-13'], ['NDAs signed by 40 invited parties', '2026-11-09', '2026-11-20'],
    ['Information memorandum (IM) issued', '2026-11-16', '2026-11-27'], ['First-round non-binding bids', '2026-11-30', '2026-12-11'],
    ['Shortlist and Gate 1 decision', '2026-12-14', '2026-12-18', 'Gate 1'], ['Management presentations', '2027-01-04', '2027-01-15'],
    ['Data room open for due diligence', '2027-01-04', '2027-01-29'], ['Final binding bids', '2027-01-25', '2027-01-29'],
    ['Bid evaluation and Gate 2 decision', '2027-02-01', '2027-02-02', 'Gate 2'], ['SPA negotiation with top bidder', '2027-02-01', '2027-02-05'],
    ['Board and works council approval', '2027-02-03', '2027-02-05']];
  const rows = plan.map(([label, start, end, gate], i) => ({ id: `r${i}`, label, items: [{ id: `b${i}`, kind: 'bar', start, end },
    ...(gate ? [{ id: `g${i}`, kind: 'milestone', start: end, label: gate, scope: 'shared' }] : [])] }));
  rows.push({ id: 'sign', label: 'Signing', items: [{ id: 'signing', kind: 'milestone', start: '2027-02-05' }] } as never);
  return rows;
};

// Two-line row names need more than the 40 px pitch, so every second name of a 12-row plan lost its seat on a pinned slide canvas.
it('gantt keeps every wrapped row name on a pinned canvas', () => {
  const rows = processRows();
  const reading = render({ spec: { type: 'gantt', data: { rows },
    options: { title: 'The process runs 14 weeks from teaser to signing, with two gates', subtitle: { measure: 'Sell-side process' }, today: '2026-12-07',
      calendar: { weeks: 'isoWeek', span: 'data' }, source: 'Invented dates', target: 'slide', size: { width: 432, height: 630, unit: 'pt' } } }, return: ['reading'] }).body.reading as { omissions: { labelId: string }[] };
  expect(reading.omissions.filter(omission => omission.labelId.startsWith('activity:'))).toEqual([]);
});

// A row pinned at exactly its text floor left a gap of 1.9999999999 px to the next name, under the solver's 2 px, so a pinned canvas at or above the declared minimum height hid a name.
it('gantt keeps every wrapped row name from the declared minimum height upward', () => {
  const rows = processRows();
  for (const width of [888, 1000]) {
    for (let height = 700; height <= 840; height++) {
      const geometry = layoutResolvedRequest(resolveChartRequest({ type: 'gantt', data: { rows },
        options: { title: 'The process runs 14 weeks from teaser to signing, with two gates', subtitle: { measure: 'Sell-side process' }, today: '2026-12-07',
          calendar: { weeks: 'isoWeek', span: 'data' }, source: 'Invented dates', target: 'slide', size: { width, height, unit: 'px' } } }));
      if (geometry.refused || height < geometry.sizing!.minHeight) continue;
      expect(geometry.labels.filter(label => label.hidden && label.id.startsWith('activity:')).map(label => `${width}x${height} ${label.id}`)).toEqual([]);
    }
  }
});

// A wrapped name needs its height plus one label gap to keep its seat, so the declared minimum height counts one gap per row, not two.
it('gantt draws every wrapped row name on a pinned canvas at the least height the names need', () => {
  const rows = Array.from({ length: 8 }, (_, i) => ({ id: `r${i}`, label: `${i % 2 ? 'Management presentations and site visits for shortlisted bidders' : 'Information memorandum prepared and issued to bidders'} ${i}`,
    items: [{ id: `b${i}`, kind: 'bar', start: `2026-11-0${1 + i}`, end: `2026-12-1${i}` }] }));
  const body = render({ spec: { type: 'gantt', data: { rows }, options: { target: 'slide', size: { width: 720, height: 430 } } }, return: ['reading'] }).body as { ok: boolean; reading: { omissions: { labelId: string }[] } };
  expect(body.ok).toBe(true);
  expect(body.reading.omissions.filter(omission => omission.labelId.startsWith('activity:'))).toEqual([]);
});

// A row whose name needs less than the 40 px pitch had no text floor, so a pinned canvas at the declared minimum height squeezed it below its name and hid the name.
it('gantt keeps every row name at the declared minimum height for rows with and without sublabels', () => {
  const names = ['Management presentations and site visits for shortlisted bidders', 'Information memorandum prepared and issued to bidders', 'Board and works council approval of the final binding offer'];
  const rows = Array.from({ length: 10 }, (_, i) => ({ id: `r${i}`, label: i < 3 ? names[i]! : `Step ${i}`, ...(i === 0 ? { sublabel: 'PMO' } : {}),
    items: [{ id: `b${i}`, kind: 'bar', start: `2026-11-${String(1 + i).padStart(2, '0')}`, end: `2026-12-${String(10 + i)}` }] }));
  const options = { theme: 'standard', size: { width: 1200 } };
  const open = layoutResolvedRequest(resolveChartRequest({ type: 'gantt', data: { rows }, options }));
  if (open.refused) throw new Error('gantt refused');
  const height = open.sizing!.minHeight;
  const body = render({ spec: { type: 'gantt', data: { rows }, options: { ...options, size: { width: 1200, height } } }, return: ['reading'] }).body as { ok: boolean; reading: { omissions: { labelId: string }[] } };
  expect(body.ok).toBe(true);
  expect(body.reading.omissions.filter(omission => omission.labelId.startsWith('activity:') || omission.labelId.startsWith('sublabel:'))).toEqual([]);
});

// A named diamond needs no key, and the today date needs no "Elapsed" key, so a 12-row plan fits the 396 pt slide; a tight height then keeps its Owner and Status columns, which only need width.
it('gantt fits 12 named-milestone rows with owner and status columns on a 888 x 396 pt slide', () => {
  const owners = ['Alex', 'Maya', 'Dan'];
  const rows = Array.from({ length: 12 }, (_, i) => ({ id: `r${i}`, label: `Workstream ${i + 1}`,
    cols: [{ text: owners[i % 3]! }, { text: i % 2 ? 'Green' : 'Amber', tone: i % 2 ? 'good' : 'warn' }],
    items: [{ id: `b${i}`, kind: 'bar', start: `2026-0${1 + (i % 4)}-10`, end: `2026-0${3 + (i % 4)}-20`, label: `Task ${i + 1}` },
      ...(i % 4 === 0 ? [{ id: `m${i}`, kind: 'milestone', start: `2026-0${3 + (i % 4)}-20`, label: 'Gate' }] : [])] }));
  const spec = { type: 'gantt', data: { rows }, options: { target: 'slide', size: { width: 1184, height: 528 }, colHeaders: ['Owner', 'Status'], today: '2026-03-01' } };
  const body = render({ spec, return: ['reading', 'svg'] }).body as { ok: boolean; svg: string; reading: { omissions: { text: string }[] } };
  expect(body.ok).toBe(true);
  for (const text of ['Milestone', 'Elapsed to today']) expect(body.svg).not.toContain(`>${text}<`);
  expect(body.svg).toContain('>Owner<');
  expect(body.svg).toContain('>Status<');
});

// A half-width slide cannot give the timeline half the plot beside Owner and Status, so the columns go and the timeline stays readable.
it('gantt drops owner and status columns on a 432 pt wide slide instead of squeezing the timeline', () => {
  const owners = ['Alex', 'Maya', 'Dan'];
  const rows = Array.from({ length: 12 }, (_, i) => ({ id: `r${i}`, label: `Workstream ${i + 1}`,
    cols: [{ text: owners[i % 3]! }, { text: i % 2 ? 'Green' : 'Amber', tone: i % 2 ? 'good' : 'warn' }],
    items: [{ id: `b${i}`, kind: 'bar', start: `2026-0${1 + (i % 4)}-10`, end: `2026-0${3 + (i % 4)}-20`, label: `Task ${i + 1}` }] }));
  const spec = { type: 'gantt', data: { rows }, options: { target: 'slide', size: { width: 576, height: 528 }, colHeaders: ['Owner', 'Status'] } };
  const body = render({ spec, return: ['svg'] }).body as { ok: boolean; svg: string };
  expect(body.ok).toBe(true);
  expect(body.svg).not.toContain('>Owner<');
});

// On a 358 px phone a bar name wider than its bar spilled over it on a halo or floated away from it, and the week row printed no name at all.
it('gantt seats phone bar names beside their bars and still names some weeks', () => {
  const fixture = getFixtures('gantt').find(f => f.id === 'product-launch')!;
  const geometry = layoutResolvedRequest(resolveChartRequest({ type: 'gantt', data: fixture.data,
    options: { ...fixture.options, size: { width: 358 } }, annotations: fixture.annotations }));
  if (geometry.refused) throw new Error('gantt refused');
  const bar = (id: string) => (geometry.marks.rows as GanttMarks['rows']).flatMap(row => row.itemNodes).find(mark => mark.id === id)!.rect;
  const name = (id: string) => geometry.labels.find(label => label.owner.segmentId === id && !label.hidden)!;
  const scope = name('prep-scope');
  expect(scope.slot).toBe('outsideRight');
  expect(scope.halo).toBeFalsy();
  expect(rectsOverlap(scope.rect, bar('prep-scope'))).toBe(false);
  const care = name('hypercare');
  expect(care.rect.x < bar('hypercare').x + bar('hypercare').w && care.rect.x + care.rect.w > bar('hypercare').x).toBe(true);
  expect(geometry.scene.filter(node => node.id.startsWith('header:minor:') && node.id.endsWith(':text')).length).toBeGreaterThan(0);
});

// A last week name clamped into the tier landed on the name before it (wide glyphs, a 280 px chart) instead of staying unprinted.
it('gantt keeps spanning week names apart when the last one is clamped into the tier', () => {
  const data = { rows: [{ id: 'build', label: 'Build', items: [{ id: 'core', kind: 'bar', label: 'Core', start: '2026-04-13', end: '2026-05-18' }] }] };
  const wide = (text: string, font: Parameters<typeof defaultMeasurer>[1]) => ({ ...defaultMeasurer(text, font), width: defaultMeasurer(text, font).width * 2 });
  const geometry = layoutResolvedRequest(resolveChartRequest({ type: 'gantt', data, options: { size: { width: 280 } }, fontMetrics: wide } as never));
  if (geometry.refused) throw new Error('gantt refused');
  const names = geometry.scene.filter((node): node is Extract<typeof node, { t: 'text' }> => node.t === 'text' && node.id.startsWith('header:minor:'));
  expect(names.length).toBeGreaterThan(1);
  names.sort((a, b) => a.x - b.x).slice(1).forEach((node, i) => expect(node.x).toBeGreaterThan(names[i]!.x + wide(names[i]!.lines[0]!, names[i]!.font).width));
});

// A diamond that prints only its date has no name to explain it, so the "Milestone" key must stay (main draws it).
it('gantt keeps the Milestone key when labels.item selects only the date', () => {
  const data = { rows: [{ id: 'review', label: 'Review', items: [{ id: 'gate', kind: 'milestone', label: 'Review gate', start: '2026-04-13' }] }] };
  const draw = (item: string[]) => (render({ spec: { type: 'gantt', data, options: { size: { width: 900 }, labels: { item } } }, return: ['svg'] }).body as { svg: string }).svg;
  expect(draw(['value'])).toContain('>Milestone<');
  expect(draw(['category', 'value'])).not.toContain('>Milestone<');
});
