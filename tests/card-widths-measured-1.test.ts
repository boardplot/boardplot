import { describe } from 'vitest';
import { measuredCases } from './card-widths-measured';

describe('Measured card floors for butterfly, likert, status, gantt, cohort, heatmap and bullet', () => measuredCases(1, 2));
