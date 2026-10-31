/**
 * The footer fields a render carries to React (footer rule). Pure, with no
 * React import: the server entry that prepares a chart reads it too.
 */
import type { FrameGeometry, SceneNode } from '../core/types/scene';
import type { RenderGeometry } from './prepared';

/** The footer fields of the frame a render carries to React. */
export type FooterFrame = Pick<FrameGeometry, 'noteList' | 'notePlacement' | 'footerRect' | 'footnoteNodeIds' | 'sourceNodeId' | 'creditNodeId' | 'notesButton' | 'notesButtonOff'>;

/** Scene nodes replaced by the HTML footer. */
export function footerNodeIds(frame?: FooterFrame): Set<string | undefined> {
  return new Set([frame?.sourceNodeId, frame?.creditNodeId, ...(frame?.footnoteNodeIds ?? [])]);
}

export function footerFrame(frame: FrameGeometry | undefined): FooterFrame | undefined {
  if (!frame?.noteList?.length) return undefined;
  const { noteList, notePlacement, footerRect, footnoteNodeIds, sourceNodeId, creditNodeId, notesButton, notesButtonOff } = frame;
  return {
    noteList, ...(notePlacement ? { notePlacement } : {}), ...(footerRect ? { footerRect } : {}),
    ...(footnoteNodeIds ? { footnoteNodeIds } : {}), ...(sourceNodeId ? { sourceNodeId } : {}), ...(creditNodeId ? { creditNodeId } : {}),
    ...(notesButton ? { notesButton } : {}), ...(notesButtonOff ? { notesButtonOff } : {}),
  };
}

/** The footer's text nodes as the layout drew them, top to bottom. */
export function footerNodes(geometry: RenderGeometry & { frame?: FooterFrame }): Extract<SceneNode, { t: 'text' }>[] {
  const ids = footerNodeIds(geometry.frame);
  return geometry.scene.filter((node): node is Extract<SceneNode, { t: 'text' }> => node.t === 'text' && ids.has(node.id)).sort((a, b) => a.y - b.y);
}

/**
 * The geometry without its drawn footer: the footer nodes leave the scene and the canvas ends at the footer's top.
 * `asDrawn` (content fit): the footer is the static one, whose lines can start above `footerRect` in the room
 * under the last chart element, so the canvas ends at its first line.
 */
export function withoutSvgFooter<G extends RenderGeometry & { frame?: FooterFrame }>(geometry: G, asDrawn = false): G {
  const rect = geometry.frame?.footerRect;
  const top = asDrawn ? footerNodes(geometry)[0]?.y ?? geometry.frame?.notesButton?.y : undefined;
  if (!rect && top === undefined) return geometry;
  const ids = footerNodeIds(geometry.frame);
  const height = top ?? rect!.y;
  const natural = geometry.presentation?.naturalSize;
  return {
    ...geometry,
    scene: geometry.scene.filter((node) => !ids.has(node.id)),
    size: { ...geometry.size, height },
    ...(geometry.presentation && natural
      ? { presentation: { ...geometry.presentation, naturalSize: { ...natural, height: natural.height * height / geometry.size.height } } } : {}),
  };
}
