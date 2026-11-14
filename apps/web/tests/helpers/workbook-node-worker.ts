import { realpathSync } from 'node:fs';
import { fileURLToPath, URL as NodeURL } from 'node:url';
import { Worker as NodeWorker } from 'node:worker_threads';
import { WORKBOOK_INPUT_EPOCH_OPTION } from '../../src/components/embedded/workbook/formula-input-provenance';
const packageRoot = realpathSync(fileURLToPath(new NodeURL('../../node_modules/@univerjs/preset-sheets-core/package.json', import.meta.url)));
export class NodeWorkbookWorker {
  readonly thread: NodeWorker;
  readonly sentInputEpochs: number[] = [];
  intercept?: (data: unknown) => void;
  acceptIncoming?: (data: unknown) => boolean;
  private listeners = new Map<EventListener, (data: unknown) => void>();
  constructor(budget = false, execution = false, stall = false, production = false) {
    this.thread = new NodeWorker(new NodeURL('../fixtures/workbook-formula-rpc-worker.ts', import.meta.url), { workerData: { packageRoot, stall, productionEntry: production ? fileURLToPath(new NodeURL('../../src/components/embedded/workbook/workbook-formula.worker.ts', import.meta.url)) : undefined, executionModule: execution ? fileURLToPath(new NodeURL('../../src/components/embedded/workbook/formula-execution-policy.ts', import.meta.url)) : undefined, budgetModule: budget ? fileURLToPath(new NodeURL('../../src/components/embedded/workbook/formula-worker-budget.ts', import.meta.url)) : undefined }, execArgv: ['--experimental-transform-types', '--no-warnings'], resourceLimits: { maxOldGenerationSizeMb: 192, maxYoungGenerationSizeMb: 32 } });
  }
  terminate() { void this.thread.terminate(); }
  postMessage(data: unknown) {
    const inspect = (value: unknown, depth = 0): void => {
      if (depth > 12 || !value || typeof value !== 'object') return;
      const record = value as Record<string, unknown>;
      if (typeof record[WORKBOOK_INPUT_EPOCH_OPTION] === 'number') this.sentInputEpochs.push(record[WORKBOOK_INPUT_EPOCH_OPTION] as number);
      for (const nested of Object.values(record)) inspect(nested, depth + 1);
    };
    inspect(data); this.intercept?.(data); this.thread.postMessage(data);
  }
  addEventListener(type: string, listener: EventListener) { if (type !== 'message') return; const handler = (data: unknown) => { if (this.acceptIncoming?.(data) !== false) listener({ data } as MessageEvent); }; this.listeners.set(listener, handler); this.thread.on('message', handler); }
  removeEventListener(_type: string, listener: EventListener) { const handler = this.listeners.get(listener); if (handler) this.thread.off('message', handler); this.listeners.delete(listener); }
  async ready() { await new Promise<void>((resolve, reject) => { const timer = setTimeout(() => reject(Error('Owned RPC worker did not start.')), 5000); this.thread.once('error', reject); const listen = (data: { fixtureReady?: boolean; type?: string; kind?: string }) => { if (data.fixtureReady || data.type === 'studio:workbook-calculation-worker' && data.kind === 'ready') { clearTimeout(timer); this.thread.off('message', listen); resolve(); } }; this.thread.on('message', listen); }); }
}
