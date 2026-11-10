import { readFile, writeFile } from 'node:fs/promises';
import { renderSnapshot } from './runner.js';

try {
  const input = JSON.parse(await readFile('/job/input.json', 'utf8'));
  const result = await renderSnapshot('/source', '/output', input);
  await writeFile('/output/result.json', JSON.stringify({ ok: true, ...result }), { flag: 'wx', mode: 0o600 });
} catch (error) {
  await writeFile('/output/result.json', JSON.stringify({ ok: false, error: error instanceof Error ? error.message.slice(0, 1000) : 'Export failed' }), { flag: 'wx', mode: 0o600 });
  process.exitCode = 1;
}
