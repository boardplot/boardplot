const encodePart = (value: string): string => {
  const encoded = encodeURIComponent(value);
  return `${encoded.length}:${encoded}`;
};

export function diagramSceneId(namespace: string, ...parts: string[]): string {
  return [namespace, ...parts].map(encodePart).join('|');
}

export { compareText as compareDiagramIds } from '../../text';

export function automaticEdgeId(preset: string, index: number, source: string, target: string): string {
  return `auto:${diagramSceneId(preset, String(index), source, target)}`;
}
