/**
 * Staircase category labels (options.categoryLabels 'staircase'): long names
 * over sorted columns, each in the free space over the lower columns to its
 * right with a vertical leader. Invented data.
 */

import type { Fixture } from '../../registry';
import type { RangeChartData } from '../../types/data';
import type { ColumnOptions } from '../../types/options';

const ROLES: [id: string, label: string, transfers: number, retirements: number, growth: number][] = [
  ['pick', 'Order pickers, packers, and sorters', 11.2, 4.1, 0],
  ['fork', 'Forklift and industrial truck operators', 7.6, 4.3, 0.6],
  ['van', 'Delivery van and light truck drivers', 7.2, 3.9, 0.8],
  ['lead', 'Shift leads of warehouse and dispatch teams', 5.4, 2.9, 0.7],
  ['tech', 'Maintenance technicians', 3.1, 1.9, 0.4],
  ['dock', 'Dock and yard coordinators', 4.0, 1.8, -0.9],
  ['inv', 'Inventory control clerks and cycle counters', 2.8, 1.7, 0.9],
  ['plan', 'Route planners', 2.9, 1.4, 0.4],
  ['ret', 'Returns processing associates', 2.4, 1.3, 0.3],
  ['qa', 'Quality checkers and damage inspectors', 2.3, 1.1, 0.3],
  ['cust', 'Customer service agents for delivery issues', 2.2, 1.0, 0.3],
  ['sec', 'Site security staff', 2.3, 1.1, -0.3],
  ['it', 'Scanner and handheld support', 1.4, 0.8, 0.1],
  ['hr', 'Recruiters and onboarding trainers', 1.2, 0.7, 0.1],
  ['fac', 'Facility cleaners', 1.0, 0.6, 0.1],
  ['eng', 'Automation engineers', 0.7, 0.4, 0.3],
];

const roleData = (order: readonly number[]): RangeChartData => ({
  categories: order.map((i) => ({ id: ROLES[i]![0], label: ROLES[i]![1] })),
  series: [
    { id: 'transfers', label: 'Role transfers', values: order.map((i) => ROLES[i]![2]) },
    { id: 'retirements', label: 'Retirements', values: order.map((i) => ROLES[i]![3]) },
    { id: 'growth', label: 'Net new roles', values: order.map((i) => ROLES[i]![4]) },
  ],
});

// Sorted by the net each column stands for, so a stack with a negative part takes its net's place.
const net = (i: number): number => ROLES[i]![2] + ROLES[i]![3] + ROLES[i]![4];
const sorted = ROLES.map((_, i) => i).sort((a, b) => net(b) - net(a) || a - b);

export const staircaseColumnFixtures: Fixture<RangeChartData, ColumnOptions>[] = [
  {
    id: 'staircase-labels-stacked',
    title: 'Staircase category labels: 16 sorted stacked columns with long names and two negative segments',
    kind: 'example',
    tags: ['feature:options'],
    data: roleData(sorted),
    options: {
      size: { width: 960, height: 720 },
      variant: 'stacked',
      categoryLabels: 'staircase',
      labels: { segment: false },
      legend: 'top',
      title: 'Order picking needs the most new staff over the next five years',
      subtitle: { measure: 'Staff needed by role, regional logistics network', period: '2026–30' },
      unit: 'thousands',
      source: 'Illustrative workforce plan',
    },
  },
  {
    id: 'staircase-labels-unsorted-fallback',
    title: 'Torture: staircase labels over unsorted columns fall back to the category row with a warning',
    kind: 'torture',
    data: roleData([5, 0, 12, 2, 15, 1, 9, 3, 14, 4, 10, 6, 13, 7, 11, 8]),
    options: {
      size: { width: 960, height: 600 },
      variant: 'stacked',
      categoryLabels: 'staircase',
      labels: { segment: false },
      legend: 'top',
      title: 'Unsorted roles leave no free space for staircase names',
    },
  },
];
