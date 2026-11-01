/**
 * The request as it was drawn. A column whose names cannot fit steps to horizontal bars
 * (charts/column/stepToBar.ts), and its records, hover and key order are those of a bar.
 */
export function drawnRequest<R extends { type: string }>(request: R, geometry: { type: string }): R {
  return request.type === 'column' && geometry.type === 'bar' ? { ...request, type: 'bar' } : request;
}
