// Pure source parsing shared by the live notes panel and export workers.
type ScriptBlock = {
  start: number;
  end: number;
  open: string;
  body: string;
  close: string;
};

const SCRIPT_OPEN_RE = /<script\b[^>]*>/gi;
const SCRIPT_CLOSE_RE = /<\/script\s*>/gi;
const SPEAKER_NOTES_ID_RE = /\bid\s*=\s*(?:"speaker-notes"|'speaker-notes'|speaker-notes)(?=[\s/>])/i;

export function normalizeSpeakerNotes(notes: readonly string[], slideCount = 0): string[] {
  const count = Math.max(slideCount, notes.length, 0);
  const next = Array.from({ length: count }, (_, index) => notes[index] ?? '');
  while (next.length > 0 && next[next.length - 1]?.trim() === '') next.pop();
  return next;
}

export function extractSpeakerNotesFromHtml(source: string | null | undefined, slideCount = 0): string[] {
  if (!source) return normalizeSpeakerNotes([], slideCount);
  const jsonNotes = extractSpeakerNotesJson(source);
  if (jsonNotes.length > 0) return normalizeSpeakerNotes(jsonNotes, slideCount);
  const inlineNotes = extractInlineSlideNotes(source);
  if (inlineNotes.length > 0) return normalizeSpeakerNotes(inlineNotes, slideCount);
  return normalizeSpeakerNotes([], slideCount);
}

function extractSpeakerNotesJson(source: string): string[] {
  const block = findSpeakerNotesScriptBlock(source);
  if (!block) return [];
  const raw = block.body.trim();
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.map((item) => String(item ?? '').trim());
    if (parsed && typeof parsed === 'object' && Array.isArray((parsed as { notes?: unknown }).notes)) {
      return (parsed as { notes: unknown[] }).notes.map((item) => String(item ?? '').trim());
    }
  } catch {
    // Invalid JSON is not a usable notes payload. Older regex-based parsing
    // could accidentally target deck runtime comments that merely mentioned
    // the speaker-notes tag; treating that tail as plain text produced long
    // garbage notes in template-created decks.
  }
  return [];
}

export function findSpeakerNotesScriptBlock(source: string): ScriptBlock | null {
  SCRIPT_OPEN_RE.lastIndex = 0;
  let openMatch: RegExpExecArray | null;
  while ((openMatch = SCRIPT_OPEN_RE.exec(source))) {
    const open = openMatch[0] ?? '';
    const bodyStart = SCRIPT_OPEN_RE.lastIndex;
    SCRIPT_CLOSE_RE.lastIndex = bodyStart;
    const closeMatch = SCRIPT_CLOSE_RE.exec(source);
    const bodyEnd = closeMatch?.index ?? source.length;
    const close = closeMatch?.[0] ?? '';
    const end = closeMatch ? SCRIPT_CLOSE_RE.lastIndex : source.length;

    if (SPEAKER_NOTES_ID_RE.test(open)) {
      return {
        start: openMatch.index,
        end,
        open,
        body: source.slice(bodyStart, bodyEnd),
        close,
      };
    }

    if (!closeMatch) break;
    SCRIPT_OPEN_RE.lastIndex = end;
  }
  return null;
}

function extractInlineSlideNotes(source: string): string[] {
  const slideBlocks = source.match(/<section\b(?=[^>]*\bclass\s*=\s*(["'])[^"']*\bslide\b[^"']*\1)[^>]*>[\s\S]*?<\/section>/gi) ?? [];
  const blocks = slideBlocks.length > 0 ? slideBlocks : [source];
  return blocks.map((block) => {
    const noteMatch = /<(?:aside|div)\b(?=[^>]*\bclass\s*=\s*(["'])[^"']*\bnotes\b[^"']*\1)[^>]*>([\s\S]*?)<\/(?:aside|div)>/i.exec(block);
    return noteMatch ? stripHtmlToText(noteMatch[2] ?? '') : '';
  });
}

function stripHtmlToText(value: string): string {
  return decodeBasicHtmlEntities(
    value
      .replace(/<script\b[\s\S]*?<\/script>/gi, '')
      .replace(/<style\b[\s\S]*?<\/style>/gi, '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p\s*>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/\r\n?/g, '\n')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim(),
  );
}

function decodeBasicHtmlEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/gi, "'");
}

