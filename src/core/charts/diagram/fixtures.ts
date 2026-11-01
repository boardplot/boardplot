import { registerFixtures } from '../../../fixtures/registry';
import type { Fixture } from '../../registry';
import type { DiagramData, DiagramOptions, DiagramVisualRole } from '../../types/diagram';

export const fixtures: Fixture<DiagramData, DiagramOptions>[] = [
  {
    id: 'org-structure',
    title: 'A three-level operating model keeps decision ownership visible',
    kind: 'example',
    tags: ['interaction'],
    hover: { owner: { segmentId: 'e-delivery-operations' } },
    data: {
      nodes: [
        { id: 'executive', kind: 'entity', shape: { kind: 'roundedRect' }, label: 'Executive team', icon: 'people', role: 'accent', order: 0 },
        { id: 'product', kind: 'entity', shape: { kind: 'roundedRect' }, label: 'Product', icon: 'lightbulb', role: 'primary', order: 1 },
        { id: 'delivery', kind: 'entity', shape: { kind: 'roundedRect' }, label: 'Delivery', icon: 'workflow', role: 'primary', order: 2 },
        { id: 'markets', kind: 'entity', shape: { kind: 'roundedRect' }, label: 'Markets', icon: 'conversation', role: 'primary', order: 3 },
        { id: 'platform', kind: 'entity', shape: { kind: 'roundedRect' }, label: 'Platform', role: 'secondary', order: 1 },
        { id: 'experience', kind: 'entity', shape: { kind: 'roundedRect' }, label: 'Experience', role: 'secondary', order: 2 },
        { id: 'operations', kind: 'entity', shape: { kind: 'roundedRect' }, label: 'Operations', role: 'secondary', order: 3 },
        { id: 'service', kind: 'entity', shape: { kind: 'roundedRect' }, label: 'Service', role: 'secondary', order: 4 },
        { id: 'sales', kind: 'entity', shape: { kind: 'roundedRect' }, label: 'Sales', role: 'secondary', order: 5 },
        { id: 'partnerships', kind: 'entity', shape: { kind: 'roundedRect' }, label: 'Partnerships', role: 'secondary', order: 6 },
      ],
      edges: [
        { id: 'e-exec-product', source: { nodeId: 'executive' }, target: { nodeId: 'product' } },
        { id: 'e-exec-delivery', source: { nodeId: 'executive' }, target: { nodeId: 'delivery' } },
        { id: 'e-exec-markets', source: { nodeId: 'executive' }, target: { nodeId: 'markets' } },
        { id: 'e-product-platform', source: { nodeId: 'product' }, target: { nodeId: 'platform' } },
        { id: 'e-product-experience', source: { nodeId: 'product' }, target: { nodeId: 'experience' } },
        { id: 'e-delivery-operations', source: { nodeId: 'delivery' }, target: { nodeId: 'operations' } },
        { id: 'e-delivery-service', source: { nodeId: 'delivery' }, target: { nodeId: 'service' } },
        { id: 'e-markets-sales', source: { nodeId: 'markets' }, target: { nodeId: 'sales' } },
        // A tree of reporting lines only. The dotted Service-to-Sales
        // link it carried ran along the Markets spine and read as a line to
        // Partnerships; `authored-routing` keeps the dotted and dashed edges.
        { id: 'e-markets-partnerships', source: { nodeId: 'markets' }, target: { nodeId: 'partnerships' } },
      ],
    },
    options: {
      variant: 'hierarchy',
      title: 'Operating model and accountable divisions',
      subtitle: 'Decision rights and delivery teams',
      source: 'Illustrative organization design',
    },
  },
  {
    id: 'profit-issue-tree',
    title: 'A four-column issue tree decomposes the profit question',
    kind: 'example',
    data: {
      nodes: [
        { id: 'profit', kind: 'issue', shape: { kind: 'roundedRect' }, label: 'How do we lift profit?', role: 'accent' },
        { id: 'revenue', kind: 'driver', shape: { kind: 'roundedRect' }, label: 'Revenue', role: 'primary', order: 1 },
        { id: 'cost', kind: 'driver', shape: { kind: 'roundedRect' }, label: 'Cost base', role: 'primary', order: 2 },
        { id: 'capital', kind: 'driver', shape: { kind: 'roundedRect' }, label: 'Capital use', role: 'primary', order: 3 },
        { id: 'price', kind: 'driver', shape: { kind: 'roundedRect' }, label: 'Price quality', role: 'secondary', order: 1 },
        { id: 'volume', kind: 'driver', shape: { kind: 'roundedRect' }, label: 'Volume growth', role: 'secondary', order: 2 },
        { id: 'direct', kind: 'driver', shape: { kind: 'roundedRect' }, label: 'Direct cost', role: 'secondary', order: 3 },
        { id: 'overhead', kind: 'driver', shape: { kind: 'roundedRect' }, label: 'Overhead', role: 'secondary', order: 4 },
        { id: 'working-capital', kind: 'driver', shape: { kind: 'roundedRect' }, label: 'Working capital', role: 'secondary', order: 5 },
        { id: 'asset-use', kind: 'driver', shape: { kind: 'roundedRect' }, label: 'Asset productivity', role: 'secondary', order: 6 },
        { id: 'mix', kind: 'driver', shape: { kind: 'roundedRect' }, label: 'Premium mix', role: 'muted', order: 1 },
        { id: 'discount-leakage', kind: 'driver', shape: { kind: 'roundedRect' }, label: 'Discount leakage', role: 'muted', order: 2 },
        { id: 'retention', kind: 'driver', shape: { kind: 'roundedRect' }, label: 'Retention', role: 'muted', order: 3 },
        { id: 'acquisition', kind: 'driver', shape: { kind: 'roundedRect' }, label: 'Acquisition', role: 'muted', order: 4 },
        { id: 'sourcing', kind: 'driver', shape: { kind: 'roundedRect' }, label: 'Sourcing', role: 'muted', order: 5 },
        { id: 'product-design', kind: 'driver', shape: { kind: 'roundedRect' }, label: 'Product design', role: 'muted', order: 6 },
        { id: 'automation', kind: 'driver', shape: { kind: 'roundedRect' }, label: 'Automation', role: 'muted', order: 7 },
        { id: 'footprint', kind: 'driver', shape: { kind: 'roundedRect' }, label: 'Footprint', role: 'muted', order: 8 },
        { id: 'receivables', kind: 'driver', shape: { kind: 'roundedRect' }, label: 'Receivables', role: 'muted', order: 9 },
        { id: 'utilization', kind: 'driver', shape: { kind: 'roundedRect' }, label: 'Utilization', role: 'muted', order: 10 },
      ],
      edges: [
        { id: 'profit-revenue', source: { nodeId: 'profit' }, target: { nodeId: 'revenue' } },
        { id: 'profit-cost', source: { nodeId: 'profit' }, target: { nodeId: 'cost' } },
        { id: 'profit-capital', source: { nodeId: 'profit' }, target: { nodeId: 'capital' } },
        { id: 'revenue-price', source: { nodeId: 'revenue' }, target: { nodeId: 'price' } },
        { id: 'revenue-volume', source: { nodeId: 'revenue' }, target: { nodeId: 'volume' } },
        { id: 'cost-direct', source: { nodeId: 'cost' }, target: { nodeId: 'direct' } },
        { id: 'cost-overhead', source: { nodeId: 'cost' }, target: { nodeId: 'overhead' } },
        { id: 'capital-working', source: { nodeId: 'capital' }, target: { nodeId: 'working-capital' } },
        { id: 'capital-asset-use', source: { nodeId: 'capital' }, target: { nodeId: 'asset-use' } },
        { id: 'price-mix', source: { nodeId: 'price' }, target: { nodeId: 'mix' } },
        { id: 'price-discount', source: { nodeId: 'price' }, target: { nodeId: 'discount-leakage' } },
        { id: 'volume-retention', source: { nodeId: 'volume' }, target: { nodeId: 'retention' } },
        { id: 'volume-acquisition', source: { nodeId: 'volume' }, target: { nodeId: 'acquisition' } },
        { id: 'direct-sourcing', source: { nodeId: 'direct' }, target: { nodeId: 'sourcing' } },
        { id: 'direct-product-design', source: { nodeId: 'direct' }, target: { nodeId: 'product-design' } },
        { id: 'overhead-automation', source: { nodeId: 'overhead' }, target: { nodeId: 'automation' } },
        { id: 'overhead-footprint', source: { nodeId: 'overhead' }, target: { nodeId: 'footprint' } },
        { id: 'working-receivables', source: { nodeId: 'working-capital' }, target: { nodeId: 'receivables' } },
        { id: 'asset-utilization', source: { nodeId: 'asset-use' }, target: { nodeId: 'utilization' } },
      ],
    },
    options: {
      variant: 'issue-tree',
      title: 'Profit improvement breaks into revenue, cost, and capital levers',
      subtitle: 'Driver tree from question to actionable hypotheses',
      source: 'Illustrative diagnostic',
    },
  },
  {
    id: 'transformation-process',
    title: 'Five equal chevrons show the transformation sequence',
    kind: 'example',
    data: {
      nodes: [
        { id: 'diagnose', kind: 'step', shape: { kind: 'chevron' }, label: 'Diagnose', caption: 'Baseline', icon: 'document', order: 1, role: 'primary' },
        { id: 'design', kind: 'step', shape: { kind: 'chevron' }, label: 'Design', caption: 'Blueprint', icon: 'lightbulb', order: 2, role: 'primary' },
        { id: 'mobilize', kind: 'step', shape: { kind: 'chevron' }, label: 'Mobilize', caption: 'Teams', icon: 'people', order: 3, role: 'primary' },
        { id: 'deliver', kind: 'step', shape: { kind: 'chevron' }, label: 'Deliver', caption: 'Work', icon: 'workflow', order: 4, role: 'primary' },
        { id: 'sustain', kind: 'step', shape: { kind: 'chevron' }, label: 'Sustain', caption: 'Results', icon: 'flag', order: 5, role: 'primary' },
      ],
    },
    options: {
      variant: 'linear-process',
      title: 'Transformation delivery cadence',
      subtitle: 'Five phases from diagnosis to sustained results',
      source: 'Illustrative programme design',
    },
  },
  {
    id: 'onboarding-journey',
    title: 'Five phase lanes organize eight onboarding pain points',
    kind: 'example',
    data: {
      lanes: [
        { id: 'discover', label: 'Discover', orientation: 'vertical', role: 'category', paletteKey: 'discover', order: 1 },
        { id: 'select', label: 'Select', orientation: 'vertical', role: 'category', paletteKey: 'select', order: 2 },
        { id: 'join', label: 'Join', orientation: 'vertical', role: 'category', paletteKey: 'join', order: 3 },
        { id: 'activate', label: 'Activate', orientation: 'vertical', role: 'category', paletteKey: 'activate', order: 4 },
        { id: 'grow', label: 'Grow', orientation: 'vertical', role: 'category', paletteKey: 'grow', order: 5 },
      ],
      nodes: [
        { id: 'unclear-value', kind: 'painPoint', shape: { kind: 'roundedRect' }, label: 'Value unclear', icon: 'alert', laneId: 'discover', role: 'bad', order: 1 },
        { id: 'slow-response', kind: 'painPoint', shape: { kind: 'roundedRect' }, label: 'Slow response', laneId: 'discover', order: 2 },
        { id: 'complex-choice', kind: 'painPoint', shape: { kind: 'roundedRect' }, label: 'Choice overload', laneId: 'select', order: 1 },
        { id: 'handoff-gap', kind: 'painPoint', shape: { kind: 'roundedRect' }, label: 'Handoff gap', icon: 'conversation', laneId: 'join', role: 'bad', order: 1 },
        { id: 'setup-delay', kind: 'painPoint', shape: { kind: 'roundedRect' }, label: 'Setup delay', laneId: 'join', order: 2 },
        { id: 'first-value', kind: 'painPoint', shape: { kind: 'roundedRect' }, label: 'Value arrives late', laneId: 'activate', order: 1 },
        { id: 'support-loop', kind: 'painPoint', shape: { kind: 'roundedRect' }, label: 'Support loop', laneId: 'activate', order: 2 },
        { id: 'next-step', kind: 'painPoint', shape: { kind: 'roundedRect' }, label: 'Next step hidden', laneId: 'grow', order: 1 },
      ],
    },
    options: {
      variant: 'customer-journey',
      title: 'Onboarding journey frictions by phase',
      subtitle: 'Pain points customers report in each phase; red marks the two critical ones',
      source: 'Illustrative customer research',
    },
  },
  {
    id: 'operating-cycle',
    title: 'Four icon nodes form a complete clockwise operating cycle',
    kind: 'example',
    data: {
      nodes: [
        { id: 'sense', kind: 'step', shape: { kind: 'circle' }, label: 'Sense\nRead market signals', icon: 'target', role: 'primary', order: 1 },
        { id: 'plan', kind: 'step', shape: { kind: 'circle' }, label: 'Plan\nSet the response', icon: 'calendar', role: 'primary', order: 2 },
        { id: 'execute', kind: 'step', shape: { kind: 'circle' }, label: 'Execute\nRun the system', icon: 'gear', role: 'primary', order: 3 },
        { id: 'learn', kind: 'step', shape: { kind: 'circle' }, label: 'Learn\nLock in gains', icon: 'check', role: 'primary', order: 4 },
      ],
    },
    options: {
      variant: 'circular-process',
      // The ring takes its height from the width: the
      // former a4 page pin left the ring small in a tall, empty canvas.
      title: 'A closed operating cycle turns market signals into repeatable learning',
      subtitle: 'Four-step management cadence',
      source: 'Illustrative operating model',
    },
  },
  {
    id: 'strategy-house',
    title: 'The strategy house renders one roof, three beams, six pillars, and three base bands',
    kind: 'example',
    data: {
      groups: [
        { id: 'growth', title: 'Grow', role: 'primary', order: 1 },
        { id: 'service', title: 'Serve', role: 'primary', order: 2 },
        { id: 'scale', title: 'Scale', role: 'primary', order: 3 },
      ],
      nodes: [
        { id: 'vision', kind: 'vision', shape: { kind: 'roof' }, label: 'Trusted growth partner', role: 'accent' },
        { id: 'obj-growth', kind: 'objective', shape: { kind: 'rectangle' }, label: 'Grow', groupId: 'growth', role: 'primary' },
        { id: 'obj-service', kind: 'objective', shape: { kind: 'rectangle' }, label: 'Serve', groupId: 'service', role: 'primary' },
        { id: 'obj-scale', kind: 'objective', shape: { kind: 'rectangle' }, label: 'Scale', groupId: 'scale', role: 'primary' },
        { id: 'new-segments', kind: 'initiative', shape: { kind: 'roundedRect' }, label: 'New segments', groupId: 'growth', role: 'secondary', order: 1 },
        { id: 'pricing', kind: 'initiative', shape: { kind: 'roundedRect' }, label: 'Pricing', groupId: 'growth', role: 'secondary', order: 2 },
        { id: 'proactive-care', kind: 'initiative', shape: { kind: 'roundedRect' }, label: 'Proactive care', groupId: 'service', role: 'secondary', order: 1 },
        { id: 'digital-service', kind: 'initiative', shape: { kind: 'roundedRect' }, label: 'Digital service', groupId: 'service', role: 'secondary', order: 2 },
        { id: 'automation', kind: 'initiative', shape: { kind: 'roundedRect' }, label: 'Automation', groupId: 'scale', role: 'secondary', order: 1 },
        { id: 'shared-data', kind: 'initiative', shape: { kind: 'roundedRect' }, label: 'Shared data', groupId: 'scale', role: 'secondary', order: 2 },
        { id: 'talent', kind: 'enabler', shape: { kind: 'rectangle' }, label: 'Talent and leadership', role: 'muted', order: 1 },
        { id: 'technology', kind: 'enabler', shape: { kind: 'rectangle' }, label: 'Technology and governance', role: 'muted', order: 2 },
        { id: 'foundation', kind: 'foundation', shape: { kind: 'rectangle' }, label: 'Customer trust and financial discipline', role: 'primary' },
      ],
    },
    options: {
      variant: 'strategy-house',
      title: 'Strategy architecture',
      subtitle: 'Three growth pillars on shared capabilities and one foundation',
      source: 'Illustrative strategy',
    },
  },
  {
    id: 'growth-roadmap',
    title: 'Three phase lanes carry nine milestones on a monotone trajectory',
    kind: 'example',
    data: {
      lanes: [
        { id: 'prove', label: 'Prove', orientation: 'vertical', role: 'category', paletteKey: 'prove', order: 1 },
        { id: 'expand', label: 'Expand', orientation: 'vertical', role: 'category', paletteKey: 'expand', order: 2 },
        { id: 'lead', label: 'Lead', orientation: 'vertical', role: 'category', paletteKey: 'lead', order: 3 },
      ],
      nodes: [
        { id: 'pilot', kind: 'milestone', shape: { kind: 'circle' }, label: 'Pilot live', laneId: 'prove', role: 'category', paletteKey: 'prove', order: 1 },
        { id: 'proof', kind: 'milestone', shape: { kind: 'circle' }, label: 'Value proven', laneId: 'prove', role: 'category', paletteKey: 'prove', order: 2 },
        { id: 'playbook', kind: 'milestone', shape: { kind: 'circle' }, label: 'Playbook', laneId: 'prove', role: 'category', paletteKey: 'prove', order: 3 },
        { id: 'region-two', kind: 'milestone', shape: { kind: 'circle' }, label: 'Region two', laneId: 'expand', role: 'category', paletteKey: 'expand', order: 1 },
        { id: 'automation-live', kind: 'milestone', shape: { kind: 'circle' }, label: 'Automation', laneId: 'expand', role: 'category', paletteKey: 'expand', order: 2 },
        // 'Scale economics' found no free label seat in the notation themes at 720×540.
        { id: 'scale-economics', kind: 'milestone', shape: { kind: 'circle' }, label: 'Scale gains', laneId: 'expand', role: 'category', paletteKey: 'expand', order: 3 },
        { id: 'category-lead', kind: 'milestone', shape: { kind: 'circle' }, label: 'Category lead', laneId: 'lead', role: 'category', paletteKey: 'lead', order: 1 },
        { id: 'ecosystem', kind: 'milestone', shape: { kind: 'circle' }, label: 'Ecosystem', laneId: 'lead', role: 'category', paletteKey: 'lead', order: 2 },
        { id: 'new-standard', kind: 'milestone', shape: { kind: 'circle' }, label: 'New standard', laneId: 'lead', role: 'category', paletteKey: 'lead', order: 3 },
      ],
    },
    options: {
      variant: 'roadmap',
      size: 'slide-4x3',
      title: 'Roadmap by phase',
      subtitle: 'Nine milestones across the Prove, Expand and Lead phases',
      source: 'Illustrative growth plan',
    },
  },
  {
    id: 'deep-hierarchy',
    title: 'Deep hierarchy torture case',
    kind: 'torture',
    data: {
      nodes: Array.from({ length: 7 }, (_, index) => ({
        id: `level-${index + 1}`,
        kind: 'entity' as const,
        shape: { kind: 'roundedRect' as const },
        label: `Level ${index + 1}`,
        order: index,
      })),
      edges: Array.from({ length: 6 }, (_, index) => ({
        id: `deep-${index + 1}`,
        source: { nodeId: `level-${index + 1}` },
        target: { nodeId: `level-${index + 2}` },
      })),
    },
    options: { variant: 'hierarchy', size: 'a4', title: 'Seven levels remain explicit' },
  },
  {
    id: 'single-node',
    title: 'Single-node diagram torture case',
    kind: 'torture',
    data: {
      nodes: [{ id: 'only', kind: 'entity', shape: { kind: 'icon', name: 'document' }, label: 'Only node' }],
    },
    options: { variant: 'hierarchy', title: 'One accountable owner' },
  },
  {
    id: 'single-issue',
    title: 'Single-node issue-tree torture case',
    kind: 'torture',
    data: {
      nodes: [
        {
          id: 'question',
          kind: 'issue',
          shape: { kind: 'roundedRect' },
          label: 'What decision must the team make?',
        },
      ],
    },
    options: { variant: 'issue-tree', title: 'One decision question' },
  },
  {
    id: 'longest-labels',
    title: 'Long labels exercise wrapping without shrinking type',
    kind: 'torture',
    data: {
      nodes: [
        {
          id: 'long-root',
          kind: 'entity',
          shape: { kind: 'roundedRect' },
          label: 'Accountable executive leadership team for cross-functional transformation decisions',
          order: 1,
        },
        {
          id: 'long-child',
          kind: 'entity',
          shape: { kind: 'roundedRect' },
          label: 'Integrated delivery organization coordinating commercial, operational, and technology workstreams',
          order: 2,
        },
      ],
      edges: [
        {
          id: 'long-relationship',
          source: { nodeId: 'long-root' },
          target: { nodeId: 'long-child' },
          arrowEnd: true,
        },
      ],
    },
    options: { variant: 'hierarchy', size: 'a4', title: 'Long accountabilities remain readable' },
  },
  {
    id: 'sparse-journey',
    title: 'Sparse journey preserves explicit empty phases',
    kind: 'torture',
    data: {
      lanes: [
        { id: 'arrive', label: 'Arrive', orientation: 'vertical', order: 1 },
        { id: 'explore', label: 'Explore', orientation: 'vertical', order: 2 },
        { id: 'decide', label: 'Decide', orientation: 'vertical', order: 3 },
        { id: 'return', label: 'Return', orientation: 'vertical', order: 4 },
      ],
      nodes: [
        {
          id: 'one-friction',
          kind: 'painPoint',
          shape: { kind: 'roundedRect' },
          label: 'A single avoidable wait',
          laneId: 'decide',
          role: 'bad',
        },
      ],
    },
    options: { variant: 'customer-journey', flow: 'columns', title: 'One friction interrupts the journey' },
  },
  {
    id: 'single-step-circle',
    title: 'Single-step circular-process degenerate case',
    kind: 'torture',
    data: {
      nodes: [
        { id: 'reflect', kind: 'step', shape: { kind: 'circle' }, label: 'Reflect', icon: 'check' },
      ],
    },
    options: { variant: 'circular-process', title: 'One continuous practice' },
  },
  {
    id: 'two-step-circle',
    title: 'Two-step circular-process degenerate case',
    kind: 'torture',
    data: {
      nodes: [
        { id: 'ask', kind: 'step', shape: { kind: 'circle' }, label: 'Ask', order: 1 },
        { id: 'answer', kind: 'step', shape: { kind: 'circle' }, label: 'Answer', order: 2 },
      ],
    },
    options: { variant: 'circular-process', title: 'Two opposing steps' },
  },
  {
    id: 'authored-routing',
    title: 'Authored positions, ports, waypoints, and edge styles',
    kind: 'torture',
    data: {
      nodes: [
        {
          id: 'root:a',
          kind: 'entity',
          shape: { kind: 'roundedRect' },
          label: 'Root',
          position: { x: 0.5, y: 0.12 },
          ports: [
            { id: 'out:left', at: { side: 'bottom', offset: 0.2 }, intent: 'out', capacity: 2 },
            // Gamma leaves by its own port, so its line does not run into the
            // arrowhead of the Delta link.
            { id: 'out:centre', at: { side: 'bottom', offset: 0.5 }, intent: 'out', capacity: 1 },
            { id: 'out:right', at: { side: 'bottom', offset: 0.8 }, intent: 'out', capacity: 1 },
            { id: 'out:edge', at: { side: 'right', offset: 0.5 }, intent: 'out', capacity: 1 },
          ],
        },
        { id: 'a:b', kind: 'entity', shape: { kind: 'roundedRect' }, label: 'Alpha', position: { x: 0.18, y: 0.5 } },
        { id: 'a', kind: 'entity', shape: { kind: 'roundedRect' }, label: 'Beta', position: { x: 0.4, y: 0.78 } },
        { id: 'b:c', kind: 'entity', shape: { kind: 'roundedRect' }, label: 'Gamma', position: { x: 0.65, y: 0.5 } },
        {
          id: 'c', kind: 'entity', shape: { kind: 'roundedRect' }, label: 'Delta', position: { x: 0.84, y: 0.78 },
          // The dotted link enters from the side it comes from.
          ports: [{ id: 'in:right', at: { side: 'right' }, intent: 'in', capacity: 1 }],
        },
      ],
      edges: [
        { id: 'straight', source: { nodeId: 'root:a', portId: 'out:left' }, target: { nodeId: 'a:b' }, routing: 'straight', arrowEnd: true },
        { id: 'elbow', source: { nodeId: 'root:a', portId: 'out:left' }, target: { nodeId: 'a' }, routing: 'elbow', dash: 'dashed' },
        { id: 'orthogonal', source: { nodeId: 'root:a', portId: 'out:centre' }, target: { nodeId: 'b:c' }, routing: 'orthogonal' },
        { id: 'primary-c', source: { nodeId: 'root:a', portId: 'out:right' }, target: { nodeId: 'c' }, routing: 'orthogonal', arrowStart: true },
        {
          id: 'curved',
          source: { nodeId: 'root:a', portId: 'out:edge' },
          target: { nodeId: 'c', portId: 'in:right' },
          routing: 'curved',
          dash: 'dotted',
          // Past Delta's right edge the dotted run turns down and enters Delta's
          // right side, instead of overshooting its top to nothing.
          waypoints: [{ x: 0.92, y: 0.78 }],
        },
      ],
      key: [
        { line: 'solid', label: 'Reports to' },
        { line: 'dashed', label: 'Advises' },
        { line: 'dotted', label: 'Informal link' },
      ],
    },
    options: { variant: 'hierarchy', size: 'slide-4x3', title: 'Authored routing remains deterministic' },
  },
];

const journey = fixtures.find((fixture) => fixture.id === 'onboarding-journey')!;
fixtures.push({
  ...journey,
  id: 'onboarding-journey-serpentine',
  kind: 'torture',
  tags: ['demo', 'serpentine'],
  title: 'Onboarding phases wrap into a two-row reading path',
  options: { ...journey.options, variant: 'customer-journey', flow: 'serpentine' },
});

// a theme's diagram anatomy. The accent node in the focus, square
// corners, and a 0.5 px ring in the grid colour on every node.
const orgStructure = fixtures.find((fixture) => fixture.id === 'org-structure')!;
fixtures.push({
  id: 'org-structure-theme-ring',
  title: 'Square nodes on the panel with a hairline ring, only the accent node filled',
  // A variant of a flagship, like the serpentine journey: the seven examples stay the flagships.
  kind: 'torture',
  tags: ['feature:options'],
  data: orgStructure.data,
  options: {
    variant: 'hierarchy',
    size: 'slide-4x3',
    title: 'Operating model and accountable divisions',
    subtitle: 'Decision rights and delivery teams',
    source: 'Illustrative organization design',
    theme: {
      preset: 'boardroom',
      overrides: { color: { focus: '#0D2A43' }, marks: { nodeRadius: 0, nodeStroke: 'grid', nodeStrokeWidth: 0.5, nodeFill: 'panel' } },
    },
  },
});

// Long names at a generous size read whole. The rendered SVG has no ellipsis.
fixtures.push({
  id: 'torture-long-labels',
  title: 'Torture: long names at a generous size read whole, never cut',
  kind: 'torture',
  data: {
    nodes: [
      {
        id: 'diagnose',
        kind: 'step',
        shape: { kind: 'chevron' },
        label: 'Diagnose the baseline',
        caption: 'Baseline',
        icon: 'document',
        order: 1,
        role: 'primary',
      },
      {
        id: 'design',
        kind: 'step',
        shape: { kind: 'chevron' },
        label: 'Design the target blueprint',
        caption: 'Blueprint',
        icon: 'lightbulb',
        order: 2,
        role: 'primary',
      },
      {
        id: 'mobilize',
        kind: 'step',
        shape: { kind: 'chevron' },
        label: 'Mobilize the delivery teams',
        caption: 'Teams',
        icon: 'people',
        order: 3,
        role: 'primary',
      },
      {
        id: 'deliver',
        kind: 'step',
        shape: { kind: 'chevron' },
        label: 'Deliver in quarterly waves',
        caption: 'Work',
        icon: 'workflow',
        order: 4,
        role: 'primary',
      },
      {
        id: 'sustain',
        kind: 'step',
        shape: { kind: 'chevron' },
        label: 'Sustain and hand over',
        caption: 'Results',
        icon: 'flag',
        order: 5,
        role: 'primary',
      },
    ],
  },
  options: {
    variant: 'linear-process',
    title: 'Long names read whole at a generous size',
    subtitle: 'Transformation delivery model',
    source: 'Illustrative programme design',
    size: { width: 1440, height: 900 },
  },
});

// An at-risk pain point, phase and badge fill in the theme's warn fill and
// the key draws the same fill, as a status cell and its key do.
fixtures.push({
  ...journey,
  id: 'onboarding-journey-at-risk',
  kind: 'torture',
  tags: ['theme'],
  title: 'Onboarding journey with an at-risk phase and critical and at-risk pain points named in a key',
  data: {
    ...journey.data,
    lanes: journey.data.lanes!.map(({ paletteKey: _key, ...lane }) => (lane.id === 'join' ? { ...lane, role: 'warn' as const } : { ...lane, paletteKey: _key })),
    nodes: journey.data.nodes.map((node) => (node.id === 'setup-delay' || node.id === 'first-value'
      ? { ...node, role: 'warn' as const }
      : node.id === 'next-step' ? { ...node, badge: { text: '3', role: 'warn' as const } } : node)),
    key: [{ role: 'bad', label: 'Critical' }, { role: 'warn', label: 'At risk' }],
  },
  options: { ...journey.options, variant: 'customer-journey', subtitle: 'Pain points customers report in each phase, by severity; joining is at risk' } as DiagramOptions,
});

// a journey whose phase lanes, pain points and badges wear every
// role. Secondary and muted use distinct greys. The first category key
// shares the primary blue, so the key names that colour once.
const friction = (id: string, label: string, laneId: string, role: DiagramVisualRole, reports: string, badgeRole: DiagramVisualRole = role) => ({
  id, kind: 'painPoint' as const, shape: { kind: 'roundedRect' as const }, label, laneId,
  ...(role === 'category' ? { role, paletteKey: 'partner' } : { role }),
  badge: { text: reports, ...(badgeRole === 'category' ? { role: badgeRole, paletteKey: 'partner' } : { role: badgeRole }) },
});
fixtures.push({
  id: 'onboarding-fix-plan-sampler',
  title: 'Phase lanes, pain points and badges in every role, each colour named once in the key',
  kind: 'torture',
  tags: ['demo', 'coverage'],
  data: {
    lanes: [
      { id: 'discover', label: 'Discover', orientation: 'vertical', role: 'primary', order: 1 },
      { id: 'compare', label: 'Compare', orientation: 'vertical', role: 'secondary', order: 2 },
      { id: 'sign-up', label: 'Sign up', orientation: 'vertical', role: 'bad', order: 3 },
      { id: 'set-up', label: 'Set up', orientation: 'vertical', role: 'warn', order: 4 },
      { id: 'first-use', label: 'First use', orientation: 'vertical', role: 'accent', order: 5 },
      { id: 'adopt', label: 'Adopt', orientation: 'vertical', role: 'good', order: 6 },
      { id: 'renew', label: 'Renew', orientation: 'vertical', role: 'muted', order: 7 },
    ],
    nodes: [
      { id: 'value-unclear', kind: 'painPoint', shape: { kind: 'roundedRect' }, label: 'Value unclear', laneId: 'discover' },
      friction('choice-overload', 'Choice overload', 'compare', 'secondary', '6'),
      friction('id-check', 'ID check fails', 'sign-up', 'bad', '12'),
      friction('setup-delay', 'Setup delay', 'set-up', 'warn', '9'),
      friction('late-value', 'Value arrives late', 'first-use', 'accent', '7'),
      friction('support-loop', 'Support loop', 'adopt', 'good', '2'),
      { ...friction('paper-invoice', 'Paper invoices', 'renew', 'muted', '1'), order: 1 },
      { ...friction('reseller-renewal', 'Reseller renewal', 'renew', 'category', '3', 'primary'), order: 2 },
      { ...friction('reseller-billing', 'Reseller billing', 'renew', 'category', '2'), order: 3 },
    ],
    key: [
      { role: 'bad', label: 'Critical' },
      { role: 'warn', label: 'At risk' },
      { role: 'accent', label: 'In this sprint' },
      { role: 'good', label: 'Fixed' },
      { role: 'secondary', label: 'Not started' },
      { role: 'muted', label: 'Paused' },
      { role: 'category', paletteKey: 'partner', label: 'Partner fixes' },
    ],
  },
  options: {
    variant: 'customer-journey',
    flow: 'columns',
    size: { width: 1052, height: 468 },
    title: 'Sign-up is the one critical phase in onboarding',
    subtitle: 'Phases and pain points by fix status; badges count customer reports',
    source: 'Illustrative customer research',
  },
});

// a hierarchy that draws every group role, the elbow, orthogonal and
// straight routings, every dash and weight, the edge roles that paint, a
// port on every side in every direction, the pill, text and icon shapes and
// every key line. Leaves take their edge on the left, below their group
// title, and the padding keeps a title row in the tighter notation nodes too.
// The leaves sit in two staggered rows, so the fixed positions still fit
// the plot at 480 px wide and at 720 x 405.
const at = (x: number, y: number) => ({ position: { x, y } });
const leafIn = [{ id: 'in', at: { side: 'left' as const }, intent: 'in' as const, capacity: 1 }];
const intoLeaf = (id: string, source: string) => ({ id: `${source}-${id}`, source: { nodeId: source, portId: 'down' }, target: { nodeId: id, portId: 'in' } });
fixtures.push({
  id: 'portfolio-health-sampler',
  title: 'Seven workstreams framed by health under three programmes, every edge style named in a key',
  kind: 'torture',
  tags: ['demo', 'coverage'],
  data: {
    groups: [
      { id: 'on-track', title: 'On track', role: 'good', padding: 16 },
      { id: 'focus', title: 'Focus', role: 'accent', padding: 16 },
      { id: 'at-risk', title: 'At risk', role: 'warn', padding: 16 },
      { id: 'off-track', title: 'Off track', role: 'bad', padding: 16 },
      { id: 'paused', title: 'Paused', role: 'muted', padding: 16 },
      { id: 'support', title: 'Support', role: 'secondary', padding: 16 },
      { id: 'partner', title: 'Partner', role: 'category', paletteKey: 'partner', padding: 16 },
    ],
    nodes: [
      {
        id: 'board', kind: 'entity', shape: { kind: 'roundedRect' }, label: 'Portfolio board', ...at(0.5, 0.14),
        ports: [
          { id: 'west', at: { side: 'left' }, intent: 'out', capacity: 1 },
          { id: 'south', at: { side: 'bottom' }, intent: 'out', capacity: 1 },
          { id: 'east', at: { side: 'right' }, intent: 'out', capacity: 1 },
        ],
      },
      {
        id: 'growth', kind: 'entity', shape: { kind: 'roundedRect' }, label: 'Growth', role: 'secondary', ...at(0.2, 0.42),
        ports: [
          { id: 'top', at: { side: 'top' }, intent: 'in', capacity: 1 },
          { id: 'link', at: { side: 'right', offset: 0.3 }, intent: 'out', capacity: 1 },
          { id: 'down', at: { side: 'bottom' }, intent: 'out', capacity: 2 },
        ],
      },
      {
        id: 'ops', kind: 'entity', shape: { kind: 'roundedRect' }, label: 'Operations', role: 'secondary', ...at(0.5, 0.42),
        ports: [
          { id: 'top', at: { side: 'top' }, intent: 'in', capacity: 1 },
          { id: 'link', at: { side: 'left', offset: 0.3 }, intent: 'bidi', capacity: 1 },
          { id: 'down', at: { side: 'bottom' }, intent: 'out', capacity: 3 },
        ],
      },
      { id: 'enable', kind: 'entity', shape: { kind: 'roundedRect' }, label: 'Enablers', role: 'secondary', ...at(0.8, 0.42) },
      { id: 'pricing', kind: 'entity', shape: { kind: 'roundedRect' }, label: 'Pricing', groupId: 'on-track', ports: leafIn, ...at(0.12, 0.7) },
      { id: 'digital', kind: 'entity', shape: { kind: 'pill' }, label: 'Digital sales', groupId: 'focus', ports: leafIn, ...at(0.25, 0.9) },
      { id: 'sourcing', kind: 'entity', shape: { kind: 'roundedRect' }, label: 'Sourcing', groupId: 'at-risk', ports: leafIn, ...at(0.37, 0.7) },
      { id: 'logistics', kind: 'entity', shape: { kind: 'roundedRect' }, label: 'Logistics', groupId: 'off-track', ports: leafIn, ...at(0.63, 0.7) },
      { id: 'retail', kind: 'entity', shape: { kind: 'text' }, label: 'Retail pilots', groupId: 'paused', ports: leafIn, ...at(0.5, 0.9) },
      { id: 'finance', kind: 'entity', shape: { kind: 'icon', name: 'people' }, label: 'Finance', groupId: 'support', ports: leafIn, ...at(0.75, 0.9) },
      { id: 'agency', kind: 'entity', shape: { kind: 'roundedRect' }, label: 'Agency', groupId: 'partner', role: 'category', paletteKey: 'partner', ports: leafIn, ...at(0.88, 0.7) },
    ],
    edges: [
      { id: 'board-growth', source: { nodeId: 'board', portId: 'west' }, target: { nodeId: 'growth', portId: 'top' }, routing: 'elbow' },
      { id: 'board-ops', source: { nodeId: 'board', portId: 'south' }, target: { nodeId: 'ops', portId: 'top' }, routing: 'orthogonal', weight: 'strong', role: 'primary' },
      { id: 'board-enable', source: { nodeId: 'board', portId: 'east' }, target: { nodeId: 'enable' }, dash: 'dashed' },
      { id: 'growth-ops', source: { nodeId: 'growth', portId: 'link' }, target: { nodeId: 'ops', portId: 'link' }, routing: 'straight', dash: 'dotted', weight: 'hairline' },
      { ...intoLeaf('pricing', 'growth'), role: 'good' },
      { ...intoLeaf('digital', 'growth'), role: 'accent' },
      { ...intoLeaf('sourcing', 'ops'), role: 'warn' },
      { ...intoLeaf('logistics', 'ops'), role: 'bad', weight: 'normal' },
      { ...intoLeaf('retail', 'ops'), dash: 'solid' },
      { ...intoLeaf('finance', 'enable'), source: { nodeId: 'enable' } },
      { ...intoLeaf('agency', 'enable'), source: { nodeId: 'enable' }, dash: 'dashed', weight: 'hairline', role: 'category', paletteKey: 'partner' },
    ],
    key: [
      { line: 'solid', label: 'Reports to' },
      { line: 'dashed', label: 'Advises' },
      { line: 'dotted', label: 'Shares data' },
    ],
  },
  options: {
    variant: 'hierarchy',
    size: 'a4',
    title: 'Two of seven workstreams need the board this quarter',
    subtitle: 'Workstreams framed by health; a reporting line takes the colour of the health it carries',
    source: 'Illustrative portfolio review',
  },
});

// two divisions framed as sibling groups. The chief executive's tree
// edges enter each division head from above, and each group title sits
// beside that entry, so the edge needs no authored port and crosses no text.
fixtures.push({
  id: 'division-groups',
  title: 'Two sibling division groups whose heads take their tree edge from above',
  kind: 'torture',
  data: {
    groups: [
      { id: 'commercial', title: 'Commercial', order: 1 },
      { id: 'supply', title: 'Supply chain', order: 2 },
    ],
    nodes: [
      { id: 'ceo', kind: 'entity', shape: { kind: 'roundedRect' }, label: 'Chief executive' },
      { id: 'sales', kind: 'entity', shape: { kind: 'roundedRect' }, label: 'Sales', groupId: 'commercial', order: 1 },
      { id: 'ops', kind: 'entity', shape: { kind: 'roundedRect' }, label: 'Operations', groupId: 'supply', order: 2 },
      { id: 'retail', kind: 'entity', shape: { kind: 'roundedRect' }, label: 'Retail', groupId: 'commercial', order: 1 },
      { id: 'online', kind: 'entity', shape: { kind: 'roundedRect' }, label: 'Online', groupId: 'commercial', order: 2 },
      { id: 'plants', kind: 'entity', shape: { kind: 'roundedRect' }, label: 'Plants', groupId: 'supply', order: 1 },
      { id: 'logistics', kind: 'entity', shape: { kind: 'roundedRect' }, label: 'Logistics', groupId: 'supply', order: 2 },
    ],
    edges: [
      { id: 'ceo-sales', source: { nodeId: 'ceo' }, target: { nodeId: 'sales' } },
      { id: 'ceo-ops', source: { nodeId: 'ceo' }, target: { nodeId: 'ops' } },
      { id: 'sales-retail', source: { nodeId: 'sales' }, target: { nodeId: 'retail' } },
      { id: 'sales-online', source: { nodeId: 'sales' }, target: { nodeId: 'online' } },
      { id: 'ops-plants', source: { nodeId: 'ops' }, target: { nodeId: 'plants' } },
      { id: 'ops-logistics', source: { nodeId: 'ops' }, target: { nodeId: 'logistics' } },
    ],
  },
  options: { variant: 'hierarchy', size: { width: 720, height: 405 }, title: 'Two divisions frame their units' },
});

fixtures.push({
  id: 'long-secondary-reading', title: 'Long secondary text remains available in the reading', kind: 'torture',
  data: { nodes: [
    { id: 'root', kind: 'issue', shape: { kind: 'roundedRect' }, label: 'Whole', size: { width: 180, height: 160 }, secondaryLabel: 'A deliberately long invented description that does not fit inside the small root card and must remain available in the reading.' },
    { id: 'leaf', kind: 'driver', shape: { kind: 'roundedRect' }, label: 'Part', size: { width: 180, height: 160 }, secondaryLabel: 'A second invented explanation with more words than the fitted card can show without cutting some of the text.' },
  ], edges: [{ id: 'link', source: { nodeId: 'root' }, target: { nodeId: 'leaf' } }] },
  options: { variant: 'issue-tree', size: { width: 720, height: 405 }, title: 'The reading preserves shortened text' },
});

fixtures.push({
  id: 'four-child-start-arrow', title: 'A start arrow clears a neighbouring group frame', kind: 'torture',
  data: {
    nodes: [{ id: 'root', kind: 'entity', shape: { kind: 'roundedRect' }, label: 'Root' },
      ...['a', 'b', 'c', 'd'].map((id, i) => ({ id, kind: 'entity' as const, shape: { kind: 'roundedRect' as const }, label: `Branch ${i + 1}`, order: i, ...(id === 'c' ? { groupId: 'group' } : {}) }))],
    groups: [{ id: 'group', title: 'An invented group title that needs two lines', role: 'secondary' }],
    edges: ['a', 'b', 'c', 'd'].map(id => ({ id: `root-${id}`, source: { nodeId: 'root' }, target: { nodeId: id }, ...(id === 'd' ? { arrowStart: true } : {}) })),
  }, options: { variant: 'hierarchy', size: { width: 960, height: 540 }, title: 'Every branch has a clear route' },
});
fixtures.push({
  id: 'stacked-leaf-captions', title: 'Every stacked leaf keeps its caption', kind: 'torture',
  data: { nodes: [
    { id: 'root', kind: 'issue', shape: { kind: 'roundedRect' }, label: 'Whole' },
    ...['a', 'b', 'c'].map((id, i) => ({ id, kind: 'driver' as const, shape: { kind: 'roundedRect' as const }, label: `Part ${i + 1}`, caption: `An invented caption for part ${i + 1}`, size: { width: 180, height: 60 }, order: i })),
  ], edges: ['a', 'b', 'c'].map(id => ({ id: `root-${id}`, source: { nodeId: 'root' }, target: { nodeId: id } })) },
  options: { variant: 'issue-tree', size: { width: 960, height: 700 }, title: 'Every leaf keeps its caption' },
});

fixtures.push({
  "id": "long-border-badges",
  "title": "Long badge phrases keep clear of node labels",
  "kind": "torture",
  "data": {
    "nodes": [
      {
        "id": "q",
        "kind": "issue",
        "label": "Why did weekly orders fall in the third quarter?",
        "role": "accent",
        "shape": {"kind": "roundedRect"}
      },
      {
        "id": "demand",
        "kind": "driver",
        "label": "Demand weakened in core regions",
        "role": "primary",
        "order": 1,
        "badge": {"text": "Confirmed", "role": "warn"},
        "shape": {"kind": "roundedRect"}
      },
      {
        "id": "supply",
        "kind": "driver",
        "label": "Supply gaps on top sellers",
        "role": "primary",
        "order": 2,
        "badge": {"text": "Partly confirmed", "role": "warn"},
        "shape": {"kind": "roundedRect"}
      },
      {
        "id": "price",
        "kind": "driver",
        "label": "Price changes versus competitors",
        "role": "primary",
        "order": 3,
        "badge": {"text": "Ruled out", "role": "warn"},
        "shape": {"kind": "roundedRect"}
      },
      {
        "id": "channel",
        "kind": "driver",
        "label": "Channel mix moved to retail",
        "role": "primary",
        "order": 4,
        "badge": {"text": "Open question", "role": "warn"},
        "shape": {"kind": "roundedRect"}
      },
      {
        "id": "traffic",
        "kind": "driver",
        "label": "Fewer site visits from paid search",
        "role": "muted",
        "order": 1,
        "shape": {"kind": "roundedRect"}
      },
      {
        "id": "stock",
        "kind": "driver",
        "label": "Stock-outs on ten top items",
        "role": "muted",
        "order": 2,
        "shape": {"kind": "roundedRect"}
      },
      {
        "id": "promo",
        "kind": "driver",
        "label": "Summer promotion ended early",
        "role": "muted",
        "order": 3,
        "shape": {"kind": "roundedRect"}
      },
      {
        "id": "retail",
        "kind": "driver",
        "label": "Retail partners took share",
        "role": "muted",
        "order": 4,
        "shape": {"kind": "roundedRect"}
      }
    ],
    "edges": [
      {"id": "q-demand", "source": {"nodeId": "q"}, "target": {"nodeId": "demand"}},
      {"id": "q-supply", "source": {"nodeId": "q"}, "target": {"nodeId": "supply"}},
      {"id": "q-price", "source": {"nodeId": "q"}, "target": {"nodeId": "price"}},
      {"id": "q-channel", "source": {"nodeId": "q"}, "target": {"nodeId": "channel"}},
      {"id": "demand-traffic", "source": {"nodeId": "demand"}, "target": {"nodeId": "traffic"}},
      {"id": "supply-stock", "source": {"nodeId": "supply"}, "target": {"nodeId": "stock"}},
      {"id": "price-promo", "source": {"nodeId": "price"}, "target": {"nodeId": "promo"}},
      {"id": "channel-retail", "source": {"nodeId": "channel"}, "target": {"nodeId": "retail"}}
    ]
  },
  "options": {"variant": "issue-tree", "title": "Orders fell on four drivers", "source": "Invented data", "size": {"width": 960, "height": 540}}
});

const box = (id: string, label: string, more: Partial<DiagramData['nodes'][number]> = {}): DiagramData['nodes'][number] =>
  ({ id, kind: 'step', shape: { kind: 'rectangle' }, label, ...more });
const link = (id: string, source: string, target: string, more: Partial<NonNullable<DiagramData['edges']>[number]> = {}): NonNullable<DiagramData['edges']>[number] =>
  ({ id, source: { nodeId: source }, target: { nodeId: target }, ...more });

fixtures.push({
  id: 'protected-request', title: 'A request stays protected on its way to private processing and back', kind: 'example',
  data: {
    groups: [{ id: 'client', title: 'Client environment' }, { id: 'processing', title: 'Processing environment' }],
    nodes: [
      box('application', 'Application', { groupId: 'client' }),
      box('request', 'Protected request', { groupId: 'client', track: 'request' }),
      box('response', 'Protected response', { groupId: 'client', track: 'response' }),
      box('checks', 'Live checks', { groupId: 'processing', track: 'request' }),
      box('private', 'Private processing', { groupId: 'processing', track: 'response', role: 'accent', secondaryLabel: 'Isolated execution with no retained payloads', badge: { text: 'Preview', role: 'secondary' } }),
    ],
    edges: [
      link('prepare', 'application', 'request', { label: 'Prepare' }),
      link('send', 'request', 'checks', { label: 'Request' }),
      link('process', 'checks', 'private', { label: 'Process' }),
      link('answer', 'private', 'response', { label: 'Response' }),
      link('deliver', 'response', 'application', { label: 'Deliver', flow: 'return' }),
    ],
    channels: [{ id: 'transit', edgeIds: ['send', 'answer'], label: 'Encrypted in transit' }],
  },
  options: { variant: 'architecture', title: 'A request stays protected from the application to private processing and back', source: 'Illustrative', size: { width: 960 } },
});

fixtures.push({
  id: 'marketing-pipeline', title: 'Rejected records return to the source for repair', kind: 'example',
  data: {
    groups: [{ id: 'sources', title: 'Sources' }, { id: 'ingest', title: 'Ingestion' }, { id: 'warehouse', title: 'Warehouse' }, { id: 'use', title: 'Use' }],
    nodes: [
      box('crm', 'CRM', { groupId: 'sources', secondaryLabel: 'Contacts' }),
      box('ads', 'Ad platforms', { groupId: 'sources', secondaryLabel: 'Spend and clicks' }),
      box('web', 'Web events', { groupId: 'sources', secondaryLabel: 'Sessions' }),
      box('collector', 'Collector', { groupId: 'ingest' }),
      box('validator', 'Validator', { groupId: 'ingest', secondaryLabel: 'Schema and consent' }),
      box('staging', 'Staging', { groupId: 'warehouse' }),
      box('marts', 'Marts', { groupId: 'warehouse', role: 'accent' }),
      box('dashboards', 'Dashboards', { groupId: 'use' }),
      box('models', 'Attribution models', { groupId: 'use' }),
    ],
    edges: [
      link('crm-in', 'crm', 'collector'), link('ads-in', 'ads', 'collector'), link('web-in', 'web', 'collector'),
      link('check', 'collector', 'validator'), link('load', 'validator', 'staging'), link('shape', 'staging', 'marts'),
      link('report', 'marts', 'dashboards'), link('fit', 'marts', 'models'),
      link('rejected', 'validator', 'crm', { flow: 'return', dash: 'dashed', label: 'Rejected records', role: 'bad' }),
    ],
    key: [{ line: 'dashed', label: 'Return for repair' }],
  },
  options: { variant: 'architecture', title: 'Rejected records return to the source for repair', source: 'Illustrative', size: { width: 960 } },
});

fixtures.push({
  id: 'journey-attribution', title: 'Multi-touch attribution from customer journey to budget', kind: 'example',
  data: {
    lanes: [
      { id: 'touchpoint', label: 'Touchpoint', orientation: 'horizontal' },
      { id: 'consent', label: 'Consent and events', orientation: 'horizontal' },
      { id: 'journey', label: 'Journey data', orientation: 'horizontal' },
      { id: 'attribution', label: 'Attribution', orientation: 'horizontal' },
      { id: 'budget', label: 'Budget', orientation: 'horizontal' },
    ],
    groups: [{ id: 'personal', title: 'Personal data' }],
    nodes: [
      box('social', 'Paid social', { laneId: 'touchpoint', track: 'a', secondaryLabel: 'Day 1' }),
      box('search', 'Paid search', { laneId: 'touchpoint', track: 'b', secondaryLabel: 'Day 6' }),
      box('email', 'Email', { laneId: 'touchpoint', track: 'c', secondaryLabel: 'Day 9' }),
      box('direct', 'Direct', { laneId: 'touchpoint', track: 'd', secondaryLabel: 'Day 12' }),
      box('consent', 'Consent check', { laneId: 'consent', track: 'a', secondaryLabel: 'Consented only' }),
      box('events', 'Event collection', { laneId: 'consent', track: 'c', secondaryLabel: 'Impressions, clicks and orders' }),
      box('identity', 'Identity stitching', { laneId: 'journey', groupId: 'personal', track: 'b', secondaryLabel: 'Links devices' }),
      box('paths', 'Ordered paths', { laneId: 'journey', groupId: 'personal', track: 'd', secondaryLabel: 'One row per journey' }),
      box('markov', 'Markov chain', { laneId: 'attribution', track: 'b', secondaryLabel: 'Removal effect', role: 'accent' }),
      box('decay', 'Time decay', { laneId: 'attribution', track: 'c', secondaryLabel: 'Recency weight', role: 'secondary' }),
      box('lastclick', 'Last click', { laneId: 'attribution', track: 'd', secondaryLabel: 'Baseline', role: 'secondary' }),
      box('credit', 'Credit by channel', { laneId: 'budget', track: 'b', secondaryLabel: 'Share of conversions by model' }),
      box('shift', 'Budget shift', { laneId: 'budget', track: 'd', secondaryLabel: 'Spend moves earlier' }),
    ],
    edges: [
      link('t1', 'social', 'consent'), link('t2', 'search', 'consent'), link('t3', 'email', 'consent'), link('t4', 'direct', 'consent'),
      link('c1', 'consent', 'events'), link('c2', 'events', 'identity'), link('j1', 'identity', 'paths'),
      link('a1', 'paths', 'markov'), link('a2', 'paths', 'decay'), link('a3', 'paths', 'lastclick'),
      link('b1', 'markov', 'credit'), link('b2', 'decay', 'credit'), link('b3', 'lastclick', 'credit'), link('b4', 'credit', 'shift'),
      link('loop', 'shift', 'social', { flow: 'return', label: 'The budget shift changes the next media plan' }),
    ],
  },
  options: { variant: 'architecture', flow: 'lanes', title: 'Last-click credit hides the channels that start the journey', source: 'Illustrative', size: { width: 960 } },
});

fixtures.push({
  id: 'nested-service', title: 'A service nested three levels deep, with one protected runtime', kind: 'example',
  data: {
    groups: [
      { id: 'rules', title: 'Applies to every request', kind: 'policy' },
      { id: 'public', title: 'Public edge' },
      { id: 'region', title: 'Hosting region' },
      { id: 'cluster', title: 'Service cluster', parentId: 'region' },
      { id: 'runtime', title: 'Protected runtime', parentId: 'cluster', protected: true },
      { id: 'data', title: 'Data stores', parentId: 'region' },
    ],
    nodes: [
      { id: 'logged', kind: 'step', shape: { kind: 'rectangle' }, label: 'Every call is logged', groupId: 'rules' },
      { id: 'expiry', kind: 'step', shape: { kind: 'rectangle' }, label: 'Payloads expire in 30 days', groupId: 'rules' },
      { id: 'rotation', kind: 'step', shape: { kind: 'rectangle' }, label: 'Keys rotate each day', groupId: 'rules' },
      { id: 'gateway', kind: 'step', shape: { kind: 'rectangle' }, label: 'API gateway', secondaryLabel: 'Rate limits', groupId: 'public', track: 'request' },
      { id: 'router', kind: 'step', shape: { kind: 'rectangle' }, label: 'Request router', groupId: 'cluster', track: 'request' },
      { id: 'workers', kind: 'step', shape: { kind: 'rectangle' }, label: 'Model workers', secondaryLabel: 'Three replicas', groupId: 'runtime', track: 'request', repeat: 3 },
      { id: 'keys', kind: 'step', shape: { kind: 'rectangle' }, label: 'Key service', groupId: 'runtime', track: 'state', protected: true },
      { id: 'sessions', kind: 'step', shape: { kind: 'store' }, label: 'Session store', groupId: 'data', track: 'request' },
      { id: 'ledger', kind: 'step', shape: { kind: 'store' }, label: 'Audit ledger', groupId: 'data', track: 'state' },
    ],
    edges: [
      { id: 'in', source: { nodeId: 'gateway' }, target: { nodeId: 'router' }, label: 'Requests' },
      { id: 'run', source: { nodeId: 'router' }, target: { nodeId: 'workers' } },
      { id: 'seal', source: { nodeId: 'keys' }, target: { nodeId: 'workers' }, label: 'Keys' },
      { id: 'write', source: { nodeId: 'workers' }, target: { nodeId: 'sessions' } },
      { id: 'audit', source: { groupId: 'runtime' }, target: { nodeId: 'ledger' }, label: 'Audit trail', dash: 'dashed' },
    ],
    callouts: [
      { id: 'one', target: { nodeId: 'gateway' }, title: 'Entry', text: 'the only public address' },
      { id: 'two', target: { edgeId: 'audit' }, title: 'Audit', text: 'the runtime writes each call' },
    ],
    key: [{ line: 'dashed', label: 'Audit flow' }],
  },
  options: { variant: 'architecture', title: 'Only the protected runtime reads the keys', source: 'Illustrative', size: { width: 960 } },
});

fixtures.push({
  id: 'agent-approval', title: 'An agent reaches its tools through an approval gate', kind: 'example',
  data: {
    groups: [
      { id: 'agent', title: 'Agent' },
      { id: 'tools', title: 'Tools' },
    ],
    nodes: [
      { id: 'planner', kind: 'step', shape: { kind: 'rectangle' }, label: 'Planner', groupId: 'agent', track: 'calls' },
      { id: 'gate', kind: 'step', shape: { kind: 'rectangle' }, label: 'Approval gate', secondaryLabel: 'A person signs off', track: 'calls' },
      { id: 'search', kind: 'step', shape: { kind: 'rectangle' }, label: 'Document search', groupId: 'tools', track: 'calls' },
      { id: 'email', kind: 'step', shape: { kind: 'rectangle' }, label: 'Send email', groupId: 'tools', track: 'side' },
    ],
    edges: [
      { id: 'ask', source: { nodeId: 'planner' }, target: { nodeId: 'gate' } },
      { id: 'allow', source: { nodeId: 'gate' }, target: { nodeId: 'search' }, label: 'Allowed' },
      { id: 'send', source: { nodeId: 'gate' }, target: { nodeId: 'email' } },
      { id: 'denied', source: { nodeId: 'gate' }, target: { nodeId: 'planner' }, label: 'Denied', flow: 'return', dash: 'dashed' },
      { id: 'retry', source: { nodeId: 'planner' }, target: { nodeId: 'planner' }, label: 'Retry' },
    ],
    key: [{ line: 'dashed', label: 'Refused call' }],
  },
  options: { variant: 'architecture', highlight: ['ask', 'allow'], title: 'Every tool call passes one approval gate', source: 'Illustrative', size: { width: 960 } },
});

registerFixtures('diagram', fixtures);
