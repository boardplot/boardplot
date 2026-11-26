const SAFE_HREF = /^(?:https?:\/\/|mailto:|#)/i;

export function safeHref(href: string | undefined): string | undefined {
  if (href === undefined) return undefined;
  const trimmed = href.trim();
  return SAFE_HREF.test(trimmed) ? trimmed : undefined;
}
