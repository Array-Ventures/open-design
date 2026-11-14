import { EventEmitter } from 'node:events';
import { readFile } from 'node:fs/promises';
import { expect, it, vi } from 'vitest';

const convert = vi.hoisted(() => vi.fn());
vi.mock('node:child_process', () => ({ execFile: convert }));

import { prepareDocument } from '../src/embedded-render/documents.js';

it('sends visible frontmatter-like GFM to a reader with YAML metadata disabled', async () => {
  const input = await readFile(new URL('./fixtures/document-visible-frontmatter.md', import.meta.url), 'utf8');
  let written: string | undefined;
  convert.mockImplementation((_file, _args, _options, callback) => {
    const stdin = new EventEmitter() as EventEmitter & { end(value: string): void };
    stdin.end = value => {
      written = value;
      callback(null, Buffer.from('<hr><h2>title: Visible paragraph</h2><p>After.</p>'));
    };
    return { stdin };
  });
  const html = await prepareDocument(input, 'report.md', 'Report');
  expect(written).toBe(input);
  expect(convert).toHaveBeenCalledOnce();
  expect(convert.mock.calls[0]![1]).toContain('--from=gfm+raw_html-yaml_metadata_block');
  expect(html).toContain('Visible paragraph');
});
