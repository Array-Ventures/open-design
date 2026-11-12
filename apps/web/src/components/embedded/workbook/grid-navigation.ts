import { CommandType, ICommandService, type Univer } from '@univerjs/core';
import type { FUniver } from '@univerjs/presets';
type NavigationKernel = Pick<typeof import('@univerjs/preset-sheets-core'), 'IShortcutService' | 'KeyCode' | 'MetaKeys' | 'whenSheetEditorFocused'>;

/** This pin has no first-cell shortcut. Register a view operation with its
 * normal focus/editor guards, rather than intercepting document keystrokes. */
export function attachWorkbookNavigation(univer: Univer, api: FUniver, ready: () => boolean, kernel: NavigationKernel) {
  const { IShortcutService, KeyCode, MetaKeys, whenSheetEditorFocused } = kernel;
  const injector = univer.__getInjector(), id = 'studio.workbook.first-cell';
  const command = injector.get(ICommandService).registerCommand({
    id, type: CommandType.OPERATION,
    handler: () => {
      if (!ready()) return false;
      const sheet = api.getActiveWorkbook()?.getActiveSheet();
      if (!sheet) return false;
      sheet.setActiveSelection(sheet.getRange(0, 0));
      sheet.scrollToCell(0, 0);
      return true;
    },
  });
  try {
    const shortcut = injector.get(IShortcutService).registerShortcut({
      id, binding: KeyCode.HOME | MetaKeys.CTRL_COMMAND,
      preconditions: context => ready() && whenSheetEditorFocused(context),
    });
    return { dispose: () => { shortcut.dispose(); command.dispose(); } };
  } catch (error) { command.dispose(); throw error; }
}
