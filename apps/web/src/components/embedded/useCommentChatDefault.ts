import { useState } from 'react';
import { useEmbeddedMentionBots, type MentionBot } from './host-viewer';

// Names are host-provided display names, not regexes or arbitrary @words.
// Include punctuation used within emails, handles and domains in the boundary.
const mentionWord = /[\p{L}\p{N}\p{M}_@+-]/u;
function mentionRanges(value: string, bots: readonly MentionBot[]) {
  // All ranges and removal use this same normalized string: Unicode case
  // expansion must never be interpreted as offsets into the authored draft.
  const text = value.toLocaleLowerCase();
  const ranges: [number, number][] = [];
  for (const bot of bots) {
    const name = bot.name.toLocaleLowerCase();
    if (!name) continue;
    const token = '@' + name;
    let start = text.indexOf(token);
    while (start >= 0) {
      const before = [...text.slice(0, start)].at(-1), after = [...text.slice(start + token.length)][0];
      const domainSuffix = after === '.' && /[\p{L}\p{N}]/u.test([...text.slice(start + token.length + 1)][0] ?? '');
      if ((!before || before !== '.' && !mentionWord.test(before)) && (!after || !mentionWord.test(after)) && !domainSuffix) ranges.push([start, start + token.length]);
      start = text.indexOf(token, start + token.length);
    }
  }
  return { text, ranges };
}
export function mentionsKnownBot(value: string, bots: readonly MentionBot[]): boolean {
  return mentionRanges(value, bots).ranges.length > 0;
}

/** Recognized bot mentions alone address a recipient; they aren't a note. */
export function hasCommentBody(value: string, bots: readonly MentionBot[]): boolean {
  const { text, ranges } = mentionRanges(value, bots);
  let end = 0, body = '';
  for (const [start, next] of ranges.sort((a, b) => a[0] - b[0])) {
    if (start > end) body += text.slice(end, start);
    end = Math.max(end, next);
  }
  return Boolean((body + text.slice(end)).trim());
}

/** A mention proposes staging an actively edited root comment. A person's choice wins for the
 * whole draft, including more typing/mentions and temporary permission loss.
 * The returned value always fails closed when staging is unavailable. */
export function useCommentChatDefault(value: string, selectionKey: string, enabled: boolean, composing: boolean) {
  const bots = useEmbeddedMentionBots();
  const [choice, setChoice] = useState<{ key: string; value: boolean | null }>({ key: selectionKey, value: null });
  if (choice.key !== selectionKey) setChoice({ key: selectionKey, value: null });
  const manual = choice.key === selectionKey ? choice.value : null;
  const selected = enabled && (manual ?? (composing && mentionsKnownBot(value, bots)));
  return { selected, choose: (value: boolean) => setChoice({ key: selectionKey, value }) };
}
