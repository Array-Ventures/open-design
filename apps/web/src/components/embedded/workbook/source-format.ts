/** Source extension chooses the preparation/output format; model metadata does
 * not grant authority to convert or rename a working file. */
export const workbookSaveFormat = (fileName: string): 'csv' | 'xlsx' => /\.csv$/i.test(fileName) ? 'csv' : 'xlsx';
