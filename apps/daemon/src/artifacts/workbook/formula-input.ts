import type { WorkbookCell, WorkbookTable } from '@open-design/contracts/runtime/workbook';

const identifier = /[\p{L}\p{N}_.\\]/u;
function bracketEnd(expression: string, start: number): number {
  let depth = 0;
  for (let index = start; index < expression.length; index++) {
    const character = expression[index];
    // Apostrophe escapes special characters in structured column labels.
    if (character === "'" && /['#\[\]@]/.test(expression[index + 1] ?? '')) { index++; continue; }
    if (character === '[') depth++;
    if (character === ']' && --depth === 0) return index;
  }
  return -1;
}
/** Translate Excel @ shorthand only in actual table references. Univer 1.4's
 * lexer misclassifies this syntax as a function, so it cannot tokenize it for us.
 * Quoted literals, quoted sheet names and escaped column labels remain intact.
 * Only disposable calculation input changes, never the retained formula. */
export function calculationFormula(formula: string, sheetId: string, cell: WorkbookCell, tables: readonly WorkbookTable[]): string {
  const expression = formula.slice(1);
  let output = '', quote: string | undefined;
  for (let index = 0; index < expression.length; index++) {
    const character = expression[index]!;
    if (quote) {
      output += character;
      if (character === quote) {
        if (expression[index + 1] === quote) output += expression[++index];
        else quote = undefined;
      }
      continue;
    }
    if (character === '"' || character === "'") { quote = character; output += character; continue; }
    if (character !== '[') { output += character; continue; }
    const end = bracketEnd(expression, index);
    if (end < 0) { output += expression.slice(index); break; }
    const before = expression.slice(0, index);
    const qualified = tables.find(table => before.toLowerCase().endsWith(table.name.toLowerCase()) && !identifier.test(before[before.length - table.name.length - 1] ?? ''));
    const implicit = !identifier.test(before.at(-1) ?? '') && !identifier.test(expression[end + 1] ?? '') && expression[end + 1] !== '!'
      ? tables.find(table => table.sheetId === sheetId && cell.row >= table.range.startRow && cell.row <= table.range.endRow && cell.column >= table.range.startColumn && cell.column <= table.range.endColumn) : undefined;
    if (expression[index + 1] === '@' && (qualified || implicit)) {
      const selection = expression.slice(index + 2, end);
      output += `${qualified ? '' : implicit!.name}[[#This Row],${selection.startsWith('[') ? selection : `[${selection}]`}]`;
    } else output += expression.slice(index, end + 1);
    index = end;
  }
  return output;
}
