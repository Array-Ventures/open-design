import type ExcelJS from 'exceljs-community';
import { workbookStyleSchema, type WorkbookColor, type WorkbookFont, type WorkbookStyle } from '@open-design/contracts/runtime/workbook';
import { WorkbookFormatError } from './package.js';

// These OOXML attributes are read by ExcelJS but absent from its Color typings.
export function color(value?: Partial<ExcelJS.Color> & { tint?: unknown; indexed?: unknown; auto?: unknown }): WorkbookColor | undefined {
  if (!value) return undefined;
  if (value.tint !== undefined && typeof value.tint !== 'number' || value.indexed !== undefined && typeof value.indexed !== 'number') throw new WorkbookFormatError('Invalid workbook color.');
  const tint = value.tint === undefined ? {} : { tint: value.tint };
  if (value.argb) return { kind: 'rgb', argb: value.argb.length === 6 ? `FF${value.argb}` : value.argb, ...tint };
  if (value.theme !== undefined) return { kind: 'theme', index: value.theme, ...tint };
  if (typeof value.indexed === 'number') return { kind: 'indexed', index: value.indexed, ...tint };
  if (value.auto === true) return { kind: 'auto' };
  return undefined;
}
export function font(value?: Partial<ExcelJS.Font>): WorkbookFont | undefined {
  if (!value) return undefined;
  return {
    ...(value.name === undefined ? {} : { name: value.name }), ...(value.family === undefined ? {} : { family: value.family }), ...(value.size === undefined ? {} : { size: value.size }),
    ...(value.bold === undefined ? {} : { bold: value.bold }), ...(value.italic === undefined ? {} : { italic: value.italic }),
    ...(value.strike === undefined ? {} : { strike: value.strike }),
    ...(value.underline && value.underline !== 'none' ? { underline: value.underline === true ? 'single' : value.underline } : {}),
    ...(value.vertAlign === 'superscript' || value.vertAlign === 'subscript' ? { vertical: value.vertAlign } : {}), ...(color(value.color) ? { color: color(value.color)! } : {}),
  };
}
export function style(value: Partial<ExcelJS.Style>): WorkbookStyle {
  const alignment = value.alignment;
  const border: NonNullable<WorkbookStyle['borders']> = {};
  for (const side of ['top', 'right', 'bottom', 'left', 'diagonal'] as const) {
    const source = value.border?.[side];
    if (source?.style) border[side] = { style: source.style, ...(color(source.color) ? { color: color(source.color)! } : {}) };
  }
  const diagonal = value.border?.diagonal;
  if (diagonal?.up !== undefined) border.diagonalUp = diagonal.up;
  if (diagonal?.down !== undefined) border.diagonalDown = diagonal.down;
  return workbookStyleSchema.parse({
    ...(value.font ? { font: font(value.font) } : {}), ...(value.numFmt ? { numberFormat: value.numFmt } : {}),
    ...(value.fill ? { fill: fill(value.fill) } : {}),
    ...(alignment ? { alignment: {
      ...(alignment.horizontal ? { horizontal: alignment.horizontal } : {}), ...(alignment.vertical ? { vertical: alignment.vertical } : {}),
      ...(alignment.wrapText === undefined ? {} : { wrap: alignment.wrapText }), ...(alignment.shrinkToFit === undefined ? {} : { shrink: alignment.shrinkToFit }),
      ...(alignment.indent === undefined ? {} : { indent: alignment.indent }), ...(alignment.textRotation === undefined ? {} : { rotation: alignment.textRotation }),
    } } : {}),
    ...(Object.keys(border).length ? { borders: border } : {}),
  });
}

function fill(value: ExcelJS.Fill): WorkbookStyle['fill'] {
  if (value.type === 'pattern') return { pattern: value.pattern, ...(color(value.fgColor) ? { foreground: color(value.fgColor)! } : {}), ...(color(value.bgColor) ? { background: color(value.bgColor)! } : {}) };
  const stops = value.stops.map(stop => {
    const normalized = color(stop.color);
    if (!normalized) throw new WorkbookFormatError('Workbook gradient color is missing.');
    return { position: stop.position, color: normalized };
  });
  return value.gradient === 'angle' ? { gradient: 'angle', degree: value.degree, stops } : { gradient: 'path', center: value.center, stops };
}
