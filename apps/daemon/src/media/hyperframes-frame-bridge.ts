import { load as loadHtml } from 'cheerio';
import { isMotionVideoComposition, markMotionFrameRender, MOTION_TIMELINE_CHECK_SCRIPT } from '@open-design/contracts/runtime/motion-source-player';
import { findRealTagOffset, HTML_TAG_PATTERNS } from '@open-design/contracts/runtime/html-injection-points';

export function hyperFramesCompositionMetrics(html: string): {
  fps: number;
  height: number;
  width: number;
} {
  const $ = loadHtml(html);
  const root = $('[data-composition-id]').first();
  if (root.length === 0) {
    throw new Error('HyperFrames index.html has no [data-composition-id] root');
  }
  const width = Number(root.attr('data-width'));
  const height = Number(root.attr('data-height'));
  const declaredFps = Number(root.attr('data-fps'));
  const fps = Number.isFinite(declaredFps) && declaredFps > 0 ? declaredFps : 30;
  if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) {
    throw new Error(
      `HyperFrames composition has invalid dimensions: width=${String(root.attr('data-width'))}, height=${String(root.attr('data-height'))}`,
    );
  }
  if (width > 8192 || height > 8192 || fps > 240) {
    throw new Error(`HyperFrames composition exceeds renderer limits: ${width}x${height} at ${fps} fps`);
  }
  return { fps, height, width };
}

export function injectHyperFramesFrameBridge(sourceHtml: string, runtimeScript: string): string {
  const motionVideo = isMotionVideoComposition(sourceHtml);
  const safeRuntime = runtimeScript.replace(/<\/script/gi, '<\\/script');
  const guardedRuntime = motionVideo ? `
${MOTION_TIMELINE_CHECK_SCRIPT}
(async () => {
  try {
    const deadline = Date.now() + 15000;
    const root = document.querySelector('[data-composition-id]');
    let tl;
    while (!(tl = window.__timelines && root && window.__timelines[root.dataset.compositionId]) && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    const error = window.__odValidateMotionTimeline(root, tl);
    if (error) throw new Error(error);
    ${safeRuntime}
  } catch (error) { window.__odMotionTimingError = String(error.message || error); }
})();` : safeRuntime;
  const bridge = `<script>${guardedRuntime}</script><script>
(() => {
  const nextPaint = () => new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    setTimeout(finish, 100);
    requestAnimationFrame(() => requestAnimationFrame(finish));
  });
  const waitForRuntime = async () => {
    const deadline = Date.now() + 45000;
    while (Date.now() < deadline) {
      if (window.__odMotionTimingError) throw new Error(window.__odMotionTimingError);
      const player = window.__player;
      const duration = Number(player && typeof player.getDuration === 'function' && player.getDuration());
      if (window.__renderReady === true && player && typeof player.renderSeek === 'function' && duration > 0) {
        return { duration, seek: (timeSeconds) => player.renderSeek(timeSeconds, { suppressEvents: ${!motionVideo} }) };
      }
      const legacy = window.__hf;
      if (legacy && typeof legacy.seek === 'function' && Number(legacy.duration) > 0) {
        return { duration: Number(legacy.duration), seek: (timeSeconds) => legacy.seek(timeSeconds) };
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    const player = window.__player;
    const duration = Number(player && typeof player.getDuration === 'function' && player.getDuration());
    throw new Error(
      'HyperFrames runtime was not ready after 45 seconds' +
      ' (bootstrapped=' + String(window.__hyperframeRuntimeBootstrapped === true) +
      ', playerReady=' + String(window.__playerReady === true) +
      ', renderReady=' + String(window.__renderReady === true) +
      ', duration=' + String(duration) + ')'
    );
  };
  window.__odFrameRenderer = {
    async ready() {
      const runtime = await waitForRuntime();
      const root = document.querySelector('[data-composition-id]');
      const declaredDuration = Number(root && root.getAttribute('data-duration'));
      const declaredFps = Number(root && root.getAttribute('data-fps'));
      return {
        duration: Number.isFinite(declaredDuration) && declaredDuration > 0
          ? declaredDuration
          : Number(runtime.duration),
        fps: declaredFps > 0 ? declaredFps : 30
      };
    },
    async seek(timeSeconds) {
      const runtime = await waitForRuntime();
      runtime.seek(timeSeconds);
      if (typeof window.__hfWaitForSeekCompletion === 'function') {
        await window.__hfWaitForSeekCompletion();
      }
      const colorGrading = window.__hf && window.__hf.colorGrading;
      if (colorGrading && typeof colorGrading.waitForActiveLuts === 'function') {
        await colorGrading.waitForActiveLuts();
      }
      if (window.__hf_page_composite_pending && typeof window.__hf_page_composite_prepare === 'function') {
        await window.__hf_page_composite_prepare();
        await nextPaint();
        if (typeof window.__hf_page_composite_resolve === 'function') {
          window.__hf_page_composite_resolve();
        }
      }
      await nextPaint();
    }
  };
})();
</script>`;
  sourceHtml = markMotionFrameRender(sourceHtml);
  const bodyClose = findRealTagOffset(sourceHtml, HTML_TAG_PATTERNS.bodyClose);
  if (bodyClose >= 0) {
    return sourceHtml.slice(0, bodyClose) + bridge + sourceHtml.slice(bodyClose);
  }
  return `${sourceHtml}${bridge}`;
}

