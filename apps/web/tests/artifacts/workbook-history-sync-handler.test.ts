import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { CommandType, type IExecutionOptions } from '@univerjs/core';
import { createWorkbookBirthFixture } from '../helpers/workbook-birth-fixture';

const closing: Array<() => void> = [];
afterEach(() => { for (const close of closing.splice(0)) close(); });
function fixture() {
  const f = createWorkbookBirthFixture();
  closing.push(() => f.univer.dispose());
  return f;
}
it('selects explicit synchronous behavior without invoking or scheduling the async handler', async () => {
  const f = fixture();
  let asyncCalls = 0, syncCalls = 0;
  const command = { id: 'owned.history.mode', type: CommandType.COMMAND,
    handler: async () => { asyncCalls++; return true; },
    syncHandler: () => { syncCalls++; return false; },
  };
  f.commands.registerCommand(command);
  expect(f.commands.syncExecuteCommand(command.id)).toBe(false);
  await Promise.resolve();
  expect(syncCalls).toBe(1);
  expect(asyncCalls).toBe(0);
  expect(await f.commands.executeCommand(command.id)).toBe(true);
  expect(syncCalls).toBe(1);
  expect(asyncCalls).toBe(1);
});
it('refuses protected synchronous invocation with no delayed work while ordinary async dispatch still works', async () => {
  const f = fixture();
  let calls = 0;
  const command = { id: 'owned.history.protect', type: CommandType.COMMAND,
    handler: async () => { calls++; f.book.getActiveSheet().getRange('A1').setValue(17); return true; },
    syncHandler: () => { throw Error('Protection requires asynchronous dispatch'); },
  };
  f.commands.registerCommand(command);
  expect(() => f.commands.syncExecuteCommand(command.id)).toThrow('Protection requires asynchronous dispatch');
  await Promise.resolve();
  expect(calls).toBe(0);
  expect(f.book.getActiveSheet().getRange('A1').getValue()).toBe(12);
  expect(await f.commands.executeCommand(command.id)).toBe(true);
  expect(calls).toBe(1);
});
it('keeps asyncOnly refusal strict even when an explicit sync handler is supplied', () => {
  const f = fixture();
  let calls = 0;
  const command = { id: 'owned.history.strict', type: CommandType.COMMAND, asyncOnly: true,
    handler: async () => { calls++; return true; }, syncHandler: () => { calls++; return true; },
  };
  f.commands.registerCommand(command);
  expect(() => f.commands.syncExecuteCommand(command.id)).toThrow('cannot be executed synchronously');
  expect(calls).toBe(0);
});

it('preserves the real synchronous params/options and listener ordering', () => {
  const f = fixture(), params = { value: 17 }, options: IExecutionOptions = { source: 'owned' };
  const order: string[] = [];
  const command = { id: 'owned.history.options', type: CommandType.COMMAND,
    handler: () => { throw Error('Wrong dispatch handler'); },
    syncHandler: (_accessor: unknown, actual?: object, actualOptions?: IExecutionOptions) => {
      expect(actual).toBe(params); expect(actualOptions).toBe(options); order.push('sync'); return true;
    },
  };
  f.commands.registerCommand(command);
  f.commands.beforeCommandExecuted(info => { if (info.id === command.id) order.push('before'); });
  f.commands.onCommandExecuted(info => { if (info.id === command.id) order.push('after'); });
  expect(f.commands.syncExecuteCommand(command.id, params, options)).toBe(true);
  expect(order).toEqual(['before','sync','after']);
});
it.each(['lib/es/index.js','lib/cjs/index.js','lib/index.js'])('selects explicit sync behavior in actual pinned %s', entry => {
  const require = createRequire(import.meta.url);
  const root = resolve(dirname(require.resolve('@univerjs/core')), '../..');
  const result = execFileSync(process.execPath, ['--input-type=module', '-e', `
import {createRequire} from 'node:module';import {pathToFileURL} from 'node:url';
const entry=process.argv[1],core=entry.includes('/cjs/')?createRequire(import.meta.url)(entry):await import(pathToFileURL(entry).href);
const univer=new core.Univer(),commands=univer.__getInjector().get(core.ICommandService);let asyncCalls=0,syncCalls=0;
commands.registerCommand({id:'mode.test',type:core.CommandType.COMMAND,handler:async()=>{asyncCalls++;return true},syncHandler:()=>{syncCalls++;return false}});
if(commands.syncExecuteCommand('mode.test')!==false||asyncCalls!==0||syncCalls!==1)throw Error('Wrong sync dispatch');
if(await commands.executeCommand('mode.test')!==true||asyncCalls!==1||syncCalls!==1)throw Error('Wrong async dispatch');
commands.registerCommand({id:'strict.test',type:core.CommandType.COMMAND,asyncOnly:true,handler:()=>true,syncHandler:()=>{throw Error('Invoked strict handler')}});
let strict=false;try{commands.syncExecuteCommand('strict.test')}catch(e){strict=String(e).includes('cannot be executed synchronously')}if(!strict)throw Error('Lost strict asyncOnly refusal');
univer.dispose();process.stdout.write(JSON.stringify({asyncCalls,syncCalls,strict}));
`, resolve(root,entry)], { encoding: 'utf8' });
  expect(JSON.parse(result)).toEqual({ asyncCalls: 1, syncCalls: 1, strict: true });
});
