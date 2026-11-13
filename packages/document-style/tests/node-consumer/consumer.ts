import { documentContrast, opaqueDocumentColorHex } from '../../dist/color.js';
const ratio: number = documentContrast([0,0,0,1], [255,255,255,1]);
const hex: string = opaqueDocumentColorHex([255,0,0,1]);
void ratio; void hex;
// @ts-expect-error The Node-safe entry must not introduce DOM globals.
type ForbiddenBrowserGlobal = Document;
