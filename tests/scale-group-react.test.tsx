// @vitest-environment jsdom
/**
 * The React entry for shared scales.
 *
 * The server pass is the strict case: renderToStaticMarkup has no effects, no
 * measurement and no second render, so a shared domain that arrives in that
 * markup can only come from the members the host declared up front. The claim
 * is pixels per unit: two separately mounted cards of equal size read the same
 * bar heights for the same values only when they share one domain.
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, expect, it } from 'vitest';
import '../src/core/charts';
import { BoardplotChart } from '../src/react/spec';
import { ColumnChart } from '../src/react/charts/column';
import { ScaleGroup, useScaleGroupPlan } from '../src/react/ScaleGroup';
import type { SharedScaleMemberRequest } from '../src/core/grid/sharedScale';
import { settle } from './helpers/spec-chunks';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const size = { width: 520, height: 340 };
const columnData = (...values: number[]) => ({
  categories: [{ id: 'q1' }, { id: 'q2' }, { id: 'q3' }],
  series: [{ id: 'share', values }],
});
type Data = ReturnType<typeof columnData>;
const euMember: SharedScaleMemberRequest = { id: 'eu', type: 'column', data: columnData(0, 30, 60) };
const usMember: SharedScaleMemberRequest = { id: 'us', type: 'column', data: columnData(0, 40, 80) };

function cards(members: SharedScaleMemberRequest[]) {
  return (
    <ScaleGroup group="fy25" members={members}>
      {members.map((member) => (
        <ColumnChart
          key={member.id}
          data={member.data as Data}
          unit="%"
          format="12.5%"
          size={size}
          scaleGroup={{ y: 'fy25', id: member.id }}
        />
      ))}
    </ScaleGroup>
  );
}

function figures(html: string): string[] {
  return html.split('</svg>').slice(0, -1).map((part) => `${part}</svg>`);
}

/** Pixels one data unit occupies in a card: its tallest bar over its peak value. */
function pixelsPerUnit(figure: string, peakValue: number): number {
  const heights = [...figure.matchAll(/<rect[^>]*data-part="bar"[^>]*>/g)].map((match) =>
    Number(/height="([\d.]+)"/.exec(match[0])![1]),
  );
  expect(heights.length).toBeGreaterThan(0);
  return Math.max(...heights) / peakValue;
}

it('resolves the declared members during SSR, without mount timing', () => {
  const single = figures(renderToStaticMarkup(cards([euMember])))[0]!;
  const shared = figures(renderToStaticMarkup(cards([euMember, usMember])));
  expect(shared).toHaveLength(2);
  // Equal dimensions and one shared domain: the same pixels per unit.
  expect(pixelsPerUnit(shared[0]!, 60)).toBeCloseTo(pixelsPerUnit(shared[1]!, 80), 2);
  // A group of one claims no shared domain, so the card keeps its own scale.
  expect(pixelsPerUnit(single, 60)).not.toBeCloseTo(pixelsPerUnit(shared[0]!, 60), 2);
});

it('keeps each card pinned when the declaration is reordered', () => {
  const forward = figures(renderToStaticMarkup(cards([euMember, usMember])));
  const reordered = figures(renderToStaticMarkup(cards([usMember, euMember])));
  expect(pixelsPerUnit(reordered[0]!, 80)).toBeCloseTo(pixelsPerUnit(forward[1]!, 80), 6);
  expect(pixelsPerUnit(reordered[1]!, 60)).toBeCloseTo(pixelsPerUnit(forward[0]!, 60), 6);
  // Equal dimensions, one domain: the same bytes, apart from React's own
  // instance identity, which the group must not touch.
  const geometry = (figure: string) => figure
    .replace(/^<\/div>/, '')
    .replace(/data-bp-instance="[^"]*"/g, 'data-bp-instance="~"')
    .replace(/_R_\d+_/g, '~');
  expect(geometry(reordered[0]!)).toEqual(geometry(forward[1]!));
});

it('names a refused member instead of silently keeping its prop', () => {
  const refusals: { memberId: string | null; code: string }[] = [];
  function Receipt() {
    const plan = useScaleGroupPlan('fy25');
    refusals.push(...(plan?.refusals ?? []).map((refusal) => ({ memberId: refusal.memberId, code: refusal.code })));
    return null;
  }
  const html = renderToStaticMarkup(
    <ScaleGroup
      group="fy25"
      members={[euMember, { id: 'kpi', type: 'kpi', data: { label: 'Revenue', value: 120 } }]}
    >
      <ColumnChart data={euMember.data as Data} unit="%" format="12.5%" size={size} scaleGroup={{ y: 'fy25', id: 'eu' }} />
      <Receipt />
    </ScaleGroup>,
  );
  expect(refusals).toEqual([
    { memberId: null, code: 'scale-group-incomplete' },
    { memberId: 'kpi', code: 'scale-group-not-numeric' },
  ]);
  // The refused member leaves the chart on its own scale; the card still draws.
  expect(figures(html)).toHaveLength(1);
});

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

it('re-resolves on the client when a member leaves the declared set', () => {
  act(() => root.render(cards([euMember, usMember])));
  const unit = pixelsPerUnit(host.innerHTML, 60);
  act(() => root.render(cards([usMember])));
  expect(pixelsPerUnit(host.innerHTML, 80)).not.toBeCloseTo(unit, 2);
});

function specCards(members: SharedScaleMemberRequest[]) {
  return <ScaleGroup group="fy25" members={members}>
    {members.map(member => <BoardplotChart key={member.id} size={size} spec={{ version: 1,
      charts: [{ name: member.id, type: 'column', data: member.data,
        options: { unit: '%', format: '12.5%', scaleGroup: { y: 'fy25', id: member.id } } }],
    }} />)}
  </ScaleGroup>;
}

// The spec entry links its chart engine on demand, so this variant is mounted
// rather than server-rendered. The claim is the same: the shared domain can
// only come from the members the host declared up front, because nothing here
// measures and no card sees the other card's layout.
it('applies the shared scale to validated JSON charts and releases it on member removal', async () => {
  await act(async () => { root.render(specCards([euMember, usMember])); });
  await settle(host);
  const shared = figures(host.innerHTML);
  expect(pixelsPerUnit(shared[0]!, 60)).toBeCloseTo(pixelsPerUnit(shared[1]!, 80), 2);
  await act(async () => { root.render(specCards([euMember])); });
  await settle(host);
  expect(pixelsPerUnit(host.innerHTML, 60)).not.toBeCloseTo(pixelsPerUnit(shared[0]!, 60), 2);
});
