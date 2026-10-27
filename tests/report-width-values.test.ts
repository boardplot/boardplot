import { describe, expect, it } from 'vitest';
import { layoutResolvedRequest, resolveChartRequest } from '../src/index';
import { getFixtures } from '../src/fixtures';

/** The value labels a fixture hides at the default report frame (720 px wide, height automatic). */
function hiddenValues(type: string, id: string): string[] {
  const fixture = getFixtures(type).find((item) => item.id === id)!;
  const { size: _size, ...options } = fixture.options as Record<string, unknown>;
  const result = layoutResolvedRequest(resolveChartRequest({ type, data: fixture.data, options: { ...options, size: { width: 720 } } }));
  if (result.refused) throw new Error(`${type}/${id} refused`);
  return result.labels.filter((label) => label.kind === 'segment' && (label.noted || label.noteCounted)).map((label) => label.id).sort();
}

describe('segment values stay on the chart at the report width', () => {
  // A stacked waterfall moved nine +2 values into a note: its sliver gate asked for
  // 4 px over the line box while the digits fit the 17 px segment.
  it('waterfall/interview-status-buildup keeps every segment value', () => {
    expect(hiddenValues('waterfall', 'interview-status-buildup')).toEqual([]);
  });

  // A stacked column moved a value into a note whose digits fit its segment: the sliver gate
  // asked for the line box plus 4 px. The value now prints at the digits' cap height.
  it('column/ordered-ramp-rest-apart keeps every segment value', () => {
    expect(hiddenValues('column', 'ordered-ramp-rest-apart')).toEqual([]);
  });

  // A likert moved its narrow outer shares into a note: the free room past each bar's end
  // went unused, and on the right the net held it before moving to its column.
  it('likert/employee-engagement-5pt keeps every share that has a seat', () => {
    // The 4% Disagree segment is 12 px wide between two others: no seat inside or beside it.
    expect(hiddenValues('likert', 'employee-engagement-5pt')).toEqual(['segment:likert:d:purpose']);
  });
});
