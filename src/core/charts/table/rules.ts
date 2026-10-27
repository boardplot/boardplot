export const STATUS_VALUES = ['on-track', 'at-risk', 'off-track', 'done', 'pending'] as const;

/** Why a badge is refused on any row but a section heading; the schema and the resolver say it alike. */
export const BADGE_SECTION_ONLY = "badge is the status chip of a section heading; set role: 'section' on this row, or drop badge";

/** Why an empty chip text is refused; the schema and the resolver say it alike. */
export const BADGE_TEXT_EMPTY = 'badge.text is empty; give the chip its text, or drop badge';
