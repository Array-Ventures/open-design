import { CommandType } from '@univerjs/core';
import { createWorkbookBirthFixture, birthScope } from './workbook-birth-fixture';
import { WorkbookWriter, type WorkbookCheckpoint, type WorkbookWriteIntent, type WorkbookWriteResult } from '../../src/components/embedded/workbook/workbook-writer';
import { WorkbookSheetHistoryController } from '../../src/components/embedded/workbook/sheet-history-controller';
import { serializeWorkbookDraft } from '../../src/components/embedded/workbook/draft-store';

export function createWorkbookHistoryControllerFixture(options: {
  save?: (state: WorkbookCheckpoint | null) => Promise<void>;
  current?: () => boolean;
  write?: (intent: WorkbookWriteIntent, checkpoint: () => Promise<void>, initial: WorkbookCheckpoint['source']) => Promise<WorkbookWriteResult>;
} = {}) {
  const f = createWorkbookBirthFixture();
  const records: Array<WorkbookCheckpoint | null> = [];
  let writes = 0;
  const writer = new WorkbookWriter(f.source, f.book.save(), async (intent, checkpoint) => {
    writes++;
    if (!options.write) throw Error('Unexpected remote write');
    return options.write(intent, checkpoint, f.source);
  }, () => {}, undefined, {
    scope: birthScope, isCurrent: options.current ?? (() => true),
    validate: state => { serializeWorkbookDraft(birthScope, state); },
    save: async state => { await options.save?.(state); records.push(state ? structuredClone(state) : null); },
  });
  const controller = new WorkbookSheetHistoryController(f.univer, writer, birthScope, () => f.book.save(), options.current ?? (() => true));
  const observer = f.commands.onCommandExecuted(command => {
    if (command.type === CommandType.MUTATION) writer.update(f.book.save());
  });
  return { ...f, writer, controller, records,
    get writes() { return writes; },
    add: (name = 'Second') => controller.add(name, f.book.save().sheetOrder.length),
    async close() { await writer.close(); observer.dispose(); controller.dispose(); f.univer.dispose(); },
  };
}
