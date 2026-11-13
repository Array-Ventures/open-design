import { deserializeRangeWithSheet, generateStringWithSequence, LexerTreeBuilder, sequenceNodeType, serializeRangeWithSheet } from '@univerjs/engine-formula';
import type { WorkbookSheetProjection } from '@open-design/contracts/runtime/workbook';
import { WorkbookFormatError } from './package.js';

/** The source admission already qualifies scalar tokens. Rewrite only parsed
 * qualified references: quoted text and unchanged references keep their bytes. */
export function workbookSheetFormula(formula: string, source: readonly { id: string; name: string }[], target: WorkbookSheetProjection): string {
  const names = new Map(source.map(sheet => [sheet.name.toLowerCase(), sheet.id]));
  const targets = new Map(target.filter(sheet => sheet.origin === 'source').map(sheet => [sheet.sheetId, sheet.name]));
  const lexer = new LexerTreeBuilder();
  try {
    const nodes = lexer.sequenceNodesBuilder(formula);
    if (!nodes || nodes.length > 100_000) throw new WorkbookFormatError('Worksheet formula analysis is unavailable.', 'WORKBOOK_UNSUPPORTED');
    let changed = false;
    const rewritten = nodes.map(node => {
      if (typeof node === 'string' || node.nodeType !== sequenceNodeType.REFERENCE) return node;
      const reference = deserializeRangeWithSheet(node.token);
      if (reference.unitId) throw new WorkbookFormatError('External worksheet references are unsupported.', 'WORKBOOK_UNSUPPORTED');
      if (!reference.sheetName) return node;
      const id = names.get(reference.sheetName.toLowerCase());
      if (!id) throw new WorkbookFormatError('Worksheet reference identity is unavailable.', 'WORKBOOK_UNSUPPORTED');
      const name = targets.get(id);
      if (name === source.find(sheet => sheet.id === id)!.name) return node;
      changed = true;
      return { ...node, token: name === undefined ? '#REF!' : serializeRangeWithSheet(name, reference.range) };
    });
    if (!changed) return formula;
    const result = generateStringWithSequence(rewritten);
    return formula.startsWith('=') && !result.startsWith('=') ? `=${result}` : result;
  } finally { lexer.dispose(); }
}
