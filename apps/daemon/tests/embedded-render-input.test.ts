import { describe, expect, it } from 'vitest';
import { RenderInput } from '../src/embedded-render/input.js';
describe('contained render request', () => {
  it('accepts local project inputs and bounded render dimensions', () => {
    expect(RenderInput.parse({ fileName: 'dist/index.html', format: 'pdf', deck: true }).deck).toBe(true);
  });
  it.each(['../index.html', '/index.html', 'a/../index.html', 'a\\index.html', 'a//index.html'])('refuses paths outside the source snapshot: %s', (fileName) => {
    expect(RenderInput.safeParse({ fileName, format: 'image' }).success).toBe(false);
  });
  it('accepts contained dashboard data and refuses path escapes or media combinations', () => {
    expect(RenderInput.parse({ fileName: 'template.html', dataFile: 'data/metrics.json', format: 'pdf' }).dataFile).toBe('data/metrics.json');
    for (const dataFile of ['../private.json', '/outside.json', 'a/../data.json', 'a\\data.json', 'a//data.json']) expect(RenderInput.safeParse({ fileName: 'template.html', dataFile, format: 'html' }).success).toBe(false);
    expect(RenderInput.safeParse({ fileName: 'motion.html', dataFile: 'data.json', format: 'hyperframes' }).success).toBe(false);
  });
  it('refuses authority fields and unbounded allocations', () => {
    expect(RenderInput.safeParse({ fileName: 'index.html', format: 'image', width: 100_000 }).success).toBe(false);
    expect(RenderInput.safeParse({ fileName: 'index.html', format: 'image', executablePath: '/host/browser' }).success).toBe(false);
    expect(RenderInput.safeParse({ fileName: 'index.html', format: 'image', index: 200 }).success).toBe(false);
  });
});
