/** Pinned private style reader used to recover Normal XF zero, which the public
 * cell reconciler omits. Keep this seam aligned with exceljs-community. */
declare module 'exceljs-community/lib/xlsx/xform/style/styles-xform.js' {
  import type { Readable } from 'node:stream';
  import type ExcelJS from 'exceljs-community';
  export default class StylesXform {
    parseStream(stream: Readable): Promise<unknown>;
    getStyleModel(id: number): Partial<ExcelJS.Style> | null;
  }
}
