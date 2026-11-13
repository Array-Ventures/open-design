import type { FUniver } from '@univerjs/presets';

export interface WorkbookExportScope { projectId: string; controllerId: string; fileName: string; sourceSha256: string; blocked: boolean }

/** Selection comes from the pinned grid facade; the worker validates it against
 * the exact immutable source bytes rather than trusting a worksheet path. */
export function workbookExportBridge(api: FUniver, scope: () => WorkbookExportScope | undefined) {
  function publish(withdraw = false) {
    const current = scope(); if (!current) return;
    const sheet = api.getActiveWorkbook()?.getActiveSheet();
    window.parent.postMessage({ type: 'studio:workbook-export-state', projectId: current.projectId, controllerId: current.controllerId,
      selection: !withdraw && !current.blocked && sheet ? { fileName: current.fileName, sourceSha256: current.sourceSha256, sheetId: sheet.getSheetId(), sheetName: sheet.getSheetName() } : null }, window.location.origin);
  }
  const receive = (event: MessageEvent) => {
    if (event.source === window.parent && event.origin === window.location.origin && event.data?.type === 'studio:artifact-request' && event.data.projectId === scope()?.projectId) publish();
  };
  window.addEventListener('message', receive);
  const changed = api.addEvent(api.Event.ActiveSheetChanged, () => publish());
  publish();
  return { publish, dispose() { publish(true); changed.dispose(); window.removeEventListener('message', receive); } };
}
