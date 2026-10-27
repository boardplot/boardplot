import { localeStrings } from '../core/strings';
import type { StringsSpec } from '../core/types/options';
/**
 * The footer rule in React: the notes, source line and
 * map credit under a chart as HTML, so a credit's links work and the notes
 * can sit behind a "Notes and sources" button. The SVG is cropped at the top
 * of the footer the layout drew (`frame.footerRect`) and this footer takes
 * its place. An export to SVG, PNG or PDF lays the chart out again and keeps
 * the SVG footer (report rule: a static image has no button).
 */

import { useRef, useState, type CSSProperties, type ReactElement, type ReactNode } from 'react';
import { useIsomorphicLayoutEffect as useLayoutEffect } from './useIsomorphicLayoutEffect';
import { footerParts, notesPointer, sourceLine, unprintedNotes, type ChartNote, type CreditLink } from '../core/notes';
import { footnoteMark } from '../core/footnoteMark';
import { footerType } from '../core/footer';
import { strokeToken, themeForWidth } from '../core/theme';
import type { FontSpec } from '../core/text';
import type { SceneNode } from '../core/types/scene';
import { footerNodeIds, footerNodes, type FooterFrame } from './footerFrame';
import type { Theme } from '../core/types/theme';
import type { RenderGeometry } from './prepared';
import { useScopedId } from './idPrefix';

/**
 * The one place the footer reads its type: the small role as the layout drew
 * it (the font of a drawn footer line), else the width-stepped theme's role.
 * A text scale the layout applies reaches the HTML footer through here.
 */
function footerFont(geometry: RenderGeometry & { frame?: FooterFrame }, theme: Theme): FontSpec {
  const ids = footerNodeIds(geometry.frame);
  const drawn = geometry.scene.find((node): node is Extract<SceneNode, { t: 'text' }> => node.t === 'text' && ids.has(node.id));
  return drawn?.font ?? { family: theme.type.family, ...footerType(themeForWidth(theme, geometry.size.width).type.footnote, geometry.presentation?.target, geometry.presentation?.textScale) };
}

/** A credit's text with its links set, in order. */
function linked(text: string, links: readonly CreditLink[] | undefined): ReactNode {
  const parts: ReactNode[] = [];
  for (const link of links ?? []) {
    const at = text.indexOf(link.text);
    if (at < 0) continue;
    parts.push(text.slice(0, at), <a key={parts.length} href={link.href} rel="noopener noreferrer" target="_blank" style={{ color: 'inherit' }}>{link.text}</a>);
    text = text.slice(at + link.text.length);
  }
  return [...parts, text];
}

interface ChartFooterProps {
  geometry: RenderGeometry & { frame?: FooterFrame };
  notes: ChartNote[];
  theme: Theme;
  /** `strings.source`, the word before the source. */
  sourceWord?: string;
  strings?: StringsSpec;
  /** `notes.show`: outside 'info', the panel and its pointer hold only the hidden notes of these kinds, as the SVG pointer counts them. */
  show?: readonly string[];
  /** Replaces the notes panel: the host shows the notes in its own appendix. */
  renderNotes?: (notes: ChartNote[]) => ReactNode;
  styleNonce?: string;
  /**
   * The host fixed the chart's height. The footer then takes
   * exactly the height the layout reserved for the footer it replaces, and
   * the notes panel opens in the browser's top layer, outside the card's clipping.
   */
  pinned?: boolean;
  /**
   * False when `notes.pointer: false` or `footnotes: false`: no "+N notes"
   * button and no panel. The source line and a required credit stay.
   */
  pointer?: boolean;
  /**
   * False when the chart's one style element already carries `FOOTER_PRINT_CSS`
   * (the hover surface's), so the chart renders one style element.
   */
  ownStyle?: boolean;
  /**
   * Content fit: the layout drew the static footer, every note the image prints, in full. The
   * footer draws those lines as drawn, at their line height and gaps, so the live chart is as
   * tall as its image (`boardplot render` at the same width). Under 'info' the notes the image
   * does not print open from a "Notes and sources (N)" button in the space the layout kept free
   * for it (`frame.notesButton`).
   */
  asDrawn?: boolean;
}

/** Shared rules also ride in the hover style element. Only the plain, inline copy prints. */
export const FOOTER_PRINT_CSS = '[data-bp-footer] span{min-width:0}'
  + '[data-bp-notes-toggle]{font:inherit;color:inherit;background:none;border:0;padding:0;text-decoration:underline;min-width:24px;min-height:24px}'
  + '[data-bp-notes-popover]{flex-direction:column;max-height:min(var(--bp-panel-cap),calc(100dvh - 16px))}'
  + '[data-bp-notes-popover]:popover-open{display:flex}'
  + '@supports(position-area:bottom){[data-bp-notes-popover]{inset:auto;position-area:bottom span-all;justify-self:anchor-center;min-height:min(64px,calc(100dvh - 16px));position-try-fallbacks:flip-block;margin:8px;max-height:min(var(--bp-panel-cap),calc(100% - 16px))}}'
  + '@media(pointer:coarse){[data-bp-notes-toggle]{min-width:44px;min-height:var(--bp-hit,44px)}}'
  + '@media print{[data-bp-footer]{height:auto!important}[data-bp-notes-panel]{display:block!important}[data-bp-notes-popover],[data-bp-notes-toggle]{display:none!important}}';

export function ChartFooter({ geometry, notes, theme, sourceWord, strings, renderNotes, styleNonce, pinned = false, pointer = true, ownStyle = true, show, asDrawn = false }: ChartFooterProps): ReactElement | null {
  const words = { ...localeStrings(), ...strings };
  const [[open, button, canPopover], setOpen] = useState<[number, HTMLButtonElement?, boolean?]>([0]);
  const native = pinned && canPopover;
  const popoverRef = useRef<HTMLDivElement>(null);
  const panelId = useScopedId();
  const rect = geometry.frame?.footerRect;
  const font = footerFont(geometry, theme);
  // The rows the layout reserved for this footer (footerParts).
  const { info, source, credit, shown, panel } = footerParts(notes, geometry.frame?.notePlacement, show, pointer);
  const width = geometry.size.width;
  const cap = Math.min((rect?.y ?? 480) * 0.5, 240);
  useLayoutEffect(() => {
    const popover = popoverRef.current;
    if (!native || !button) return;
    if (!popover) { setOpen([0]); return; }
    const toggled = (event: Event) => {
      if ((event as ToggleEvent).newState === 'closed') { setOpen([0]); button.focus(); }
    };
    // React 18 only wires its synthetic toggle event on details.
    popover.addEventListener('toggle', toggled);
    const detach = () => popover.removeEventListener('toggle', toggled);
    if (!open) { popover.hidePopover(); return detach; }
    popover.showPopover();
    if (button.ownerDocument.activeElement === button) popover.querySelector('button')?.focus();
    return detach;
  }, [open, button, native, notes, renderNotes]);
  const pad = (value: number) => `${(value / width) * 100}%`;
  if (asDrawn) return <DrawnFooter geometry={geometry} theme={theme} credit={credit} words={words} renderNotes={renderNotes} notes={notes} pad={pad}
    pointer={pointer} panelId={panelId} styleNonce={styleNonce} ownStyle={ownStyle} />;
  if (!rect && !(shown.length || source || credit || panel.length)) return null;
  // WCAG 2.2 AA 2.5.8: 24 × 24 px; this footer has no top padding for upward touch growth.
  const style = {
    font: `${font.size}px/${font.lineHeight ?? 1.3} ${font.family}`, color: theme.color.inkMuted,
    // The chart's own ground: on a dark theme the muted ink needs it for contrast.
    background: theme.color.background,
    margin: 0, overflowWrap: 'anywhere',
    paddingLeft: rect ? pad(rect.x) : undefined,
    paddingRight: rect ? pad(width - rect.x - rect.w) : undefined,
    paddingBottom: rect ? geometry.size.height - rect.y - rect.h : undefined,
    '--bp-hit': pinned ? '24px' : undefined,
    height: pinned && rect ? geometry.size.height - rect.y : undefined, boxSizing: 'border-box',
  } as CSSProperties;
  // A button and its panel: native click, Enter and Space toggle the disclosure.
  const disclosure = (bit: number) => {
    const id = `${panelId}-${bit}`;
    const isOpen = !!(open & bit);
    return {
      button: { type: 'button' as const, 'data-bp-notes-toggle': '', 'aria-expanded': isOpen, 'aria-controls': id,
        style: { anchorName: `--bp-${id}` } as CSSProperties,
        onClick: (event: React.MouseEvent<HTMLButtonElement>) => {
          // Browsers without showPopover keep the panel inline.
          setOpen([open ^ bit, event.currentTarget, pinned && typeof popoverRef.current?.showPopover === 'function']);
        } },
      panel: { id, role: 'region', 'data-bp-notes-panel': '', hidden: !isOpen },
    };
  };
  const notesD = disclosure(1);
  const creditLine = credit && (
    <>
      {words.mapCredit}: {linked(credit.text, credit.links)}
    </>
  );
  const label = info ? `${words.notesAndSources} (${panel.length})` : notesPointer(panel.length, words);
  const sourceText = source ? sourceLine(source.text, sourceWord ?? words.source) : undefined;
  const contents = (suffix = '') => <>
      {panel.length > 0 && !renderNotes && (
        <div {...notesD.panel} id={notesD.panel.id + suffix} aria-label={words.notesAndSources}>
          <ol style={{ margin: '6px 0 0', paddingLeft: '1.5em' }}>
            {panel.map((note) => (
              <li key={note.n} data-kind={note.kind} value={note.ref} style={{ listStyleType: note.ref ? undefined : 'none' }}>
                {note.kind === 'source' ? sourceText : note.kind === 'credit' ? <>{words.mapCredit}: {linked(note.text, note.links)}</> : note.text}
              </li>
            ))}
          </ol>
        </div>
      )}
  </>;
  const close = () => {
    if (native) popoverRef.current?.hidePopover();
    else { setOpen([0]); button?.focus(); }
  };
  return (
    <div data-bp-footer="" style={style} onKeyDown={(event) => {
      if (!native && open && event.key === 'Escape') {
        event.preventDefault(); event.stopPropagation(); close();
      }
    }}>
      {ownStyle && <style nonce={styleNonce}>{FOOTER_PRINT_CSS}</style>}
      {shown.map((note) => <p key={note.n} style={{ margin: 0 }}>{note.ref ? `${footnoteMark(note.ref)} ` : ''}{note.kind === 'method' || note.kind === 'disclosure' ? note.short ?? note.text : note.text}</p>)}
      {/* An empty row would still take its top margin, a row the layout does not reserve. */}
      {(sourceText || (creditLine && info) || (panel.length > 0 && !renderNotes)) && <p style={{ margin: shown.length ? '4px 0 0' : 0, display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: '2px 0.75em' }}>
        {/* Small print prints as written, as on the SVG: no period is added to a source, credit or note. */}
        {sourceText && <span>{sourceText}</span>}
        {creditLine && info && <span>{creditLine}</span>}
        {panel.length > 0 && !renderNotes && (
          <button {...notesD.button}>{label}</button>
        )}
      </p>}
      {creditLine && !info && <p style={{ margin: 0 }}>{creditLine}</p>}
      {renderNotes && renderNotes(notes)}
      {panel.length > 0 && !renderNotes && (
        <>
          <div ref={popoverRef} popover={native ? 'auto' : undefined}
            data-bp-notes-popover={native ? '' : undefined} data-bp-notes-panel={native ? undefined : ''} hidden={!native && !open}
            style={native ? { position: 'fixed', positionAnchor: button?.style.getPropertyValue('anchor-name'), width: `min(${width}px, calc(100vw - 16px))`, '--bp-panel-cap': `${cap}px`,
              boxSizing: 'border-box', color: 'inherit', background: theme.color.background,
              padding: theme.space.labelPad * 2, border: `${strokeToken(theme, 'hair')}px solid ${theme.color.grid}`,
              borderRadius: theme.surface?.chipRadius ?? 2, boxShadow: theme.surface?.panelShadow } as CSSProperties : undefined}>
            <button type="button" data-bp-notes-toggle="" style={{ alignSelf: 'flex-end', flexShrink: 0 }} onClick={close}>{words.close}</button>
            <div data-bp-notes-scroll="" style={native ? { minHeight: 0, overflowY: 'auto' } : undefined}>{contents()}</div>
          </div>
          {native && <div data-bp-notes-panel="" hidden>{contents('-print')}</div>}
        </>
      )}
    </div>
  );
}

/**
 * A credit's lines with its links set. The links are found in the whole credit text, so a
 * link that wraps keeps its link on both lines.
 */
function linkedLines(lines: readonly string[], text: string, links: readonly CreditLink[] | undefined): ReactNode[] {
  const ranges: { from: number; to: number; href: string }[] = [];
  let from = 0;
  for (const link of links ?? []) {
    const at = text.indexOf(link.text, from);
    if (at < 0) continue;
    ranges.push({ from: at, to: at + link.text.length, href: link.href });
    from = at + link.text.length;
  }
  let at = 0;
  return lines.map((line, i) => {
    const start = Math.max(at, text.indexOf(line, at));
    at = start + line.length;
    const parts: ReactNode[] = [];
    let cursor = start;
    for (const range of ranges) {
      if (range.to <= cursor || range.from >= at) continue;
      if (range.from > cursor) parts.push(text.slice(cursor, range.from));
      const end = Math.min(range.to, at);
      parts.push(<a key={`${i}-${range.from}`} href={range.href} rel="noopener noreferrer" target="_blank" style={{ color: 'inherit' }}>{text.slice(Math.max(cursor, range.from), end)}</a>);
      cursor = end;
    }
    if (cursor < at) parts.push(text.slice(cursor, at));
    return parts;
  });
}

/**
 * The footer lines as the layout drew them (`asDrawn`): each block at its own top, each line at its line height.
 * With `renderNotes` the host draws the notes: the source line, the credit and a grid panel's lines stay.
 * Under 'info' the notes the footer does not print sit behind a button in the space the layout kept for it
 * (`frame.notesButton`): after its host line, or in an empty row. The button keeps the line height; a taller
 * hit area reaches past it without moving a line. Its panel opens inline, under the lines.
 */
function DrawnFooter({ geometry, theme, credit, words, renderNotes, notes, pad, pointer, panelId, styleNonce, ownStyle }: {
  geometry: RenderGeometry & { frame?: FooterFrame }; theme: Theme; credit: ChartNote | undefined; words: StringsSpec & ReturnType<typeof localeStrings>;
  renderNotes?: (notes: ChartNote[]) => ReactNode; notes: ChartNote[]; pad: (value: number) => string;
  pointer: boolean; panelId: string; styleNonce?: string; ownStyle: boolean;
}): ReactElement | null {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const drawn = footerNodes(geometry);
  // `renderNotes` takes the chart's own notes; a grid panel's lines (`origin`) are not in them and stay.
  const blocks = renderNotes ? drawn.filter((node) => node.id === geometry.frame?.sourceNodeId || node.id === geometry.frame?.creditNodeId || node.origin) : drawn;
  const place = geometry.frame?.notesButton;
  const panel = place && pointer && !renderNotes ? unprintedNotes(notes) : [];
  if (!blocks.length && !renderNotes && !panel.length) return null;
  let bottom = blocks[0]?.y ?? place?.y ?? geometry.size.height;
  const creditText = credit && `${words.mapCredit}: ${credit.text}`;
  const x = blocks[0]?.x ?? geometry.frame?.footerRect?.x;
  const font = footerFont(geometry, theme);
  const lineHeight = font.size * (font.lineHeight ?? 1.3);
  const fontCss = (node: { font: FontSpec }, height: number) => `${node.font.style === 'italic' ? 'italic ' : ''}${node.font.weight ?? 400} ${node.font.size}px/${height}px ${node.font.family ?? theme.type.family}`;
  const button = panel.length > 0 && (
    <button ref={buttonRef} type="button" data-bp-notes-toggle="" aria-expanded={open} aria-controls={panelId} onClick={() => setOpen(!open)}
      style={{ position: 'relative', height: lineHeight, minHeight: 0, minWidth: 0, lineHeight: `${lineHeight}px`, verticalAlign: 'top', marginLeft: place?.nodeId ? '0.75em' : 0 }}>
      {words.notesAndSources} ({panel.length})
      {/* WCAG 2.2 AA 2.5.8: a 24 px tall target, outside the line box. */}
      <span aria-hidden="true" style={{ position: 'absolute', left: 0, right: 0, top: -Math.max(0, (24 - lineHeight) / 2), bottom: -Math.max(0, (24 - lineHeight) / 2) }} />
    </button>
  );
  const rows = blocks.map((node) => {
    const height = node.font.size * (node.font.lineHeight ?? 1.3);
    const gap = node.y - bottom;
    bottom = node.y + height * node.lines.length;
    const lines = node.id === geometry.frame?.creditNodeId && creditText ? linkedLines(node.lines, creditText, credit?.links) : node.lines;
    return (
      <p key={node.id} data-part={node.part} title={node.title} style={{ margin: `${Math.max(0, gap)}px 0 0`, font: fontCss(node, height), whiteSpace: 'nowrap' }}>
        {lines.map((line, i) => <span key={i} style={{ display: 'block' }}>{line}{node.id === place?.nodeId && i === lines.length - 1 && button}</span>)}
      </p>
    );
  });
  // The empty row follows the last line.
  const row = place && place.nodeId === undefined && button ? (() => {
    const gap = place.y! - bottom;
    bottom = place.y! + lineHeight;
    return <p style={{ margin: `${Math.max(0, gap)}px 0 0`, font: fontCss({ font }, lineHeight), whiteSpace: 'nowrap' }}>{button}</p>;
  })() : undefined;
  return (
    <div data-bp-footer="" style={{ color: theme.color.inkMuted, background: theme.color.background, margin: 0, boxSizing: 'border-box',
      paddingLeft: x !== undefined ? pad(x) : undefined, paddingRight: x !== undefined ? pad(x) : undefined }}
      onKeyDown={(event) => {
        if (open && event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setOpen(false); buttonRef.current?.focus(); }
      }}>
      {button && ownStyle && <style nonce={styleNonce}>{FOOTER_PRINT_CSS}</style>}
      {rows}
      {row}
      {button && (
        <div id={panelId} role="region" data-bp-notes-panel="" hidden={!open} aria-label={words.notesAndSources} style={{ font: fontCss({ font }, lineHeight), whiteSpace: 'normal' }}>
          <ol style={{ margin: '6px 0 0', paddingLeft: '1.5em' }}>
            {panel.map((note) => (
              <li key={note.n} data-kind={note.kind} value={note.ref} style={{ listStyleType: note.ref ? undefined : 'none' }}>
                {note.kind === 'credit' ? <>{words.mapCredit}: {linked(note.text, note.links)}</> : note.text}
              </li>
            ))}
          </ol>
        </div>
      )}
      {(blocks.length > 0 || row) && <div style={{ height: Math.max(0, geometry.size.height - bottom) }} />}
      {renderNotes && renderNotes(notes)}
    </div>
  );
}
