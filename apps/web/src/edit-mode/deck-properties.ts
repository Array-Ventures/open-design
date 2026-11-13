import { parse, type DefaultTreeAdapterTypes } from 'parse5';

export type DeckAspect = '16:9' | '4:3';
type Element = DefaultTreeAdapterTypes.Element;

/** Only a single canonical stage has an unambiguous, persisted size contract. */
function stageIn(source: string): Element | null {
  const stages: Element[] = [];
  function visit(node: DefaultTreeAdapterTypes.Node) {
    if ('tagName' in node && node.tagName === 'deck-stage') stages.push(node);
    if ('childNodes' in node) node.childNodes.forEach(visit);
  }
  visit(parse(source, { sourceCodeLocationInfo: true }));
  return stages.length === 1 ? stages[0]! : null;
}

export function readDeckDimensions(source: string): { width: number; height: number; aspect: DeckAspect | 'custom' } | null {
  const stage = stageIn(source);
  if (!stage?.sourceCodeLocation?.startTag) return null;
  function dimension(name: string, fallback: number) {
    const value = stage!.attrs.find(attr => attr.name === name)?.value;
    const number = value === undefined ? fallback : Number(value);
    return Number.isFinite(number) && number > 0 ? number : fallback;
  }
  const width = dimension('width', 1920), height = dimension('height', 1080);
  const aspect = Math.abs(width / height - 16 / 9) < 0.001 ? '16:9' : Math.abs(width / height - 4 / 3) < 0.001 ? '4:3' : 'custom';
  return { width, height, aspect };
}

/** Change only the stage opening tag; scripts, slides, notes and assets retain
 * their exact bytes. The existing history writer owns persistence and conflict checks. */
export function resizeDeckSource(source: string, aspect: DeckAspect): string | null {
  if (aspect !== '16:9' && aspect !== '4:3') return null;
  const stage = stageIn(source), dimensions = readDeckDimensions(source);
  const tag = stage?.sourceCodeLocation?.startTag;
  if (!stage || !tag || !dimensions) return null;
  const width = dimensions.width, height = width * (aspect === '16:9' ? 9 / 16 : 3 / 4);
  const edits: Array<{ start: number; end: number; value: string }> = [];
  let insert = '';
  for (const [name, value] of [['width', width], ['height', height]] as const) {
    const location = stage.sourceCodeLocation?.attrs?.[name];
    if (location) edits.push({ start: location.startOffset, end: location.endOffset, value: `${name}="${value}"` });
    else insert += ` ${name}="${value}"`;
  }
  if (insert) edits.push({ start: tag.endOffset - 1, end: tag.endOffset - 1, value: insert });
  return edits.sort((a, b) => b.start - a.start).reduce((result, edit) => result.slice(0, edit.start) + edit.value + result.slice(edit.end), source);
}
