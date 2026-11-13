import type { Element } from '@xmldom/xmldom';
import { WorkbookFormatError } from './package.js';

// This is an ownership allowlist, not an OOXML schema validator. Unknown
// attributes may contain references even when their element is otherwise owned.
const attributes: Record<string, string> = {
  workbook: '', fileVersion: 'appName lastEdited lowestEdited rupBuild codeName',
  workbookPr: 'date1904 showObjects showBorderUnselectedTables filterPrivacy promptedSolutions showInk backupFile saveExternalLinkValues updateLinks codeName hidePivotFieldList showPivotChartFilter allowRefreshQuery autoCompressPictures defaultThemeVersion checkCompatibility publishItems dateCompatibility refreshAllConnections',
  calcPr: 'calcId calcMode fullCalcOnLoad refMode iterate iterateCount iterateDelta fullPrecision calcCompleted calcOnSave concurrentCalc concurrentManualCount forceFullCalc',
  bookViews: '', sheets: '', definedNames: '',
  workbookView: 'visibility minimized showHorizontalScroll showVerticalScroll showSheetTabs xWindow yWindow windowWidth windowHeight tabRatio firstSheet activeTab autoFilterDateGrouping',
  sheet: 'name sheetId state', worksheet: '',
  sheetPr: 'codeName filterMode enableFormatConditionsCalculation published syncHorizontal syncVertical transitionEvaluation transitionEntry',
  tabColor: 'rgb indexed auto theme tint', outlinePr: 'applyStyles summaryBelow summaryRight showOutlineSymbols', pageSetUpPr: 'autoPageBreaks fitToPage',
  dimension: 'ref', sheetViews: '', sheetView: 'windowProtection showFormulas showGridLines showRowColHeaders showZeros rightToLeft tabSelected showRuler showOutlineSymbols defaultGridColor showWhiteSpace view topLeftCell colorId zoomScale zoomScaleNormal zoomScaleSheetLayoutView zoomScalePageLayoutView workbookViewId',
  selection: 'pane activeCell activeCellId sqref',
  sheetFormatPr: 'baseColWidth defaultColWidth defaultRowHeight customHeight zeroHeight thickTop thickBottom outlineLevelRow outlineLevelCol',
  cols: '', col: 'min max width style hidden bestFit customWidth phonetic outlineLevel collapsed', sheetData: '',
  row: 'r spans s customFormat ht hidden customHeight outlineLevel collapsed thickTop thickBot ph', c: 'r s t cm vm ph', f: 't ca', v: '', is: '', r: '', rPr: '', t: '',
  rPh: 'sb eb', phoneticPr: 'fontId type alignment', rFont: 'val', charset: 'val', family: 'val', b: 'val', i: 'val', strike: 'val', outline: 'val', shadow: 'val', condense: 'val', extend: 'val', sz: 'val', u: 'val', vertAlign: 'val', scheme: 'val', color: 'rgb indexed auto theme tint',
  mergeCells: 'count', mergeCell: 'ref', printOptions: 'horizontalCentered verticalCentered headings gridLines gridLinesSet', pageMargins: 'left right top bottom header footer',
  pageSetup: 'paperSize scale firstPageNumber fitToWidth fitToHeight pageOrder orientation usePrinterDefaults blackAndWhite draft cellComments errors horizontalDpi verticalDpi copies useFirstPageNumber',
  headerFooter: 'differentOddEven differentFirst scaleWithDoc alignWithMargins', oddHeader: '', oddFooter: '', evenHeader: '', evenFooter: '', firstHeader: '', firstFooter: '',
};
const allowed = new Map(Object.entries(attributes).map(([name, names]) => [name, new Set(names.split(' ').filter(Boolean))]));
const relationships = new Set(['http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'http://purl.oclc.org/ooxml/officeDocument/relationships']);
function reject(owner: string): never { throw new WorkbookFormatError(`This workbook has unowned structural XML metadata (${owner}).`, 'WORKBOOK_UNSUPPORTED'); }
export function assertWorkbookStructureAttributes(root: Element): void {
  const visit = (element: Element): void => {
    const name = element.localName ?? element.nodeName, names = allowed.get(name);
    if (element.namespaceURI !== root.namespaceURI || !names) reject(name);
    for (const attribute of Array.from(element.attributes)) {
      const namespace = attribute.namespaceURI, local = attribute.localName ?? attribute.name;
      if (namespace === 'http://www.w3.org/2000/xmlns/' || attribute.name === 'xmlns') continue;
      if (!namespace && !attribute.prefix && names.has(local)) continue;
      if (namespace === 'http://schemas.openxmlformats.org/markup-compatibility/2006' && local === 'Ignorable' && attribute.value.trim().split(/\s+/).every(prefix => /^[A-Za-z_][\w.-]*$/.test(prefix))) continue;
      if (namespace === 'http://www.w3.org/XML/1998/namespace' && name === 't' && local === 'space' && ['preserve', 'default'].includes(attribute.value)) continue;
      if (namespace && relationships.has(namespace) && name === 'sheet' && local === 'id') continue;
      // Excel's row/default descent is a font metric, not a worksheet coordinate.
      if (namespace === 'http://schemas.microsoft.com/office/spreadsheetml/2009/9/ac' && ['row', 'sheetFormatPr'].includes(name) && local === 'dyDescent' && attribute.value.trim() !== '' && Number.isFinite(Number(attribute.value)) && Number(attribute.value) >= 0) continue;
      reject(`${name}/@${attribute.name}`);
    }
    for (const node of Array.from(element.childNodes)) if (node.nodeType === 1) visit(node as Element);
  };
  visit(root);
}
