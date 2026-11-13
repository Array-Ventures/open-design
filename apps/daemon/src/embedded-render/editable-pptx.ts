import { readFile } from 'node:fs/promises';
import type { Page } from 'playwright-core';

type Geometry = { height: number; width: number; left: number; top: number; slideIndex: number; pageX: number; pageY: number };
const frames = (page: Page) => page.evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');

/** Browser conversion uses the same DOM normalization and layered paints as desktop. */
export async function editablePptx(page: Page, selector: string): Promise<Buffer> {
  await page.addScriptTag({ content: await readFile('/opt/render/dom-to-pptx.bundle.js', 'utf8') });
  await page.addScriptTag({ content: await readFile('/opt/render/deck-export.iife.js', 'utf8') });
  await page.evaluate(`odDeckExport.showAllSlides(${JSON.stringify(selector)})`);
  const prepared = await page.evaluate(`odDeckExport.runDomToPptx(${JSON.stringify(selector)}, {}, 'prepare')`) as { error?: string };
  if (prepared.error) throw new Error(prepared.error);
  await frames(page);
  const targets = await page.evaluate(`odDeckExport.collectLayeredPptxBackgroundTargets(${JSON.stringify(selector)})`) as { id: string }[];
  const session = await page.context().newCDPSession(page);
  const captures: Record<string, Omit<Geometry, 'pageX' | 'pageY'> & { dataUrl: string }> = {};
  try {
    await session.send('Page.enable');
    await session.send('Emulation.setDefaultBackgroundColorOverride', { color: { r: 0, g: 0, b: 0, a: 0 } });
    const dpr = await page.evaluate('window.devicePixelRatio') as number;
    for (const target of targets) {
      const geometry = await page.evaluate(`odDeckExport.isolateLayeredPptxBackground(${JSON.stringify(selector)}, ${JSON.stringify(target.id)})`) as Geometry | null;
      if (!geometry || ![geometry.width, geometry.height, geometry.pageX, geometry.pageY].every(Number.isFinite) || geometry.width <= 0 || geometry.height <= 0 || geometry.width * geometry.height > 3840 * 2160) throw new Error('Editable slide paint exceeds its capture bounds.');
      let data: string | undefined;
      for (let attempt = 0; attempt < 3; attempt++) {
        await frames(page);
        const shot = await session.send('Page.captureScreenshot', { captureBeyondViewport: true, clip: { x: geometry.pageX, y: geometry.pageY, width: geometry.width, height: geometry.height, scale: Math.min(2, 2 / dpr) }, format: 'png', fromSurface: true });
        const painted = await page.evaluate(`(async()=>{const image=new Image();image.src=${JSON.stringify('data:image/png;base64,')}+${JSON.stringify(shot.data)};await image.decode();const canvas=document.createElement('canvas');canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;const ctx=canvas.getContext('2d');ctx.drawImage(image,0,0);const pixels=ctx.getImageData(0,0,canvas.width,canvas.height).data;for(let i=3;i<pixels.length;i+=4)if(pixels[i])return true;return false})()`);
        if (painted) { data = shot.data; break; }
      }
      if (!data) throw new Error(`Transparent Chromium capture: ${target.id}`);
      const { pageX: _x, pageY: _y, ...box } = geometry;
      captures[target.id] = { ...box, dataUrl: `data:image/png;base64,${data}` };
      await page.evaluate('odDeckExport.restoreLayeredPptxBackgroundIsolation()');
    }
  } finally {
    try { await page.evaluate('odDeckExport.restoreLayeredPptxBackgroundIsolation()'); }
    finally {
      try { await session.send('Emulation.setDefaultBackgroundColorOverride'); }
      finally { await session.detach(); }
    }
  }
  const result = await page.evaluate(`odDeckExport.runDomToPptx(${JSON.stringify(selector)}, ${JSON.stringify(captures)}, 'export-prepared')`) as { b64?: string; error?: string };
  if (result.error || !result.b64) throw new Error(result.error ?? 'Editable PowerPoint conversion returned no file.');
  return Buffer.from(result.b64, 'base64');
}
