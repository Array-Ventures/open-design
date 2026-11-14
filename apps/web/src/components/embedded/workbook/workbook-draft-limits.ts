/** Shared existing recovery byte cap; full checkpoint admission remains owned by the draft encoder. */
export const MAX_WORKBOOK_DRAFT_BYTES = 128 * 1024 * 1024;
/** Existing worksheet birth/removal context count bound, also used for live issuers. */
export const MAX_WORKBOOK_SHEET_CONTEXTS = 4096;
