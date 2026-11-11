import type { ChatCommentAttachment } from '../../types';

export function commentContextText(attachments: ChatCommentAttachment[]): string {
  return attachments.map((item) => [
    `File: ${item.filePath}`,
    item.slideIndex === undefined ? '' : `Slide: ${item.slideIndex + 1}`,
    item.selector ? `Selector: ${item.selector}` : '',
    item.elementId ? `Element: ${item.elementId}` : '',
    item.label ? `Target: ${item.label}` : '',
    item.currentText ? `Current text: ${item.currentText}` : '',
    `Requested change: ${item.comment}`,
    item.screenshotPath ? `Screenshot: ${item.screenshotPath}` : '',
    ...(item.imageAttachments ?? []).map((image) => `Attached image: ${image.path}`),
  ].filter(Boolean).join('\n')).join('\n\n');
}

/** The host acknowledges staging into its normal composer, never agent execution. */
export function stageHostContext(projectId: string, text: string, operationId?: string, preparationId?: string): Promise<boolean> {
  if (window.parent === window || !text.trim() || text.length > 32_000) return Promise.resolve(false);
  const requestId = operationId ?? crypto.randomUUID();
  return new Promise((resolve) => {
    const finish = (accepted: boolean) => { clearTimeout(timeout); window.removeEventListener('message', receive); resolve(accepted); };
    const receive = (event: MessageEvent) => {
      if (event.origin !== window.location.origin || event.source !== window.parent) return;
      const data = event.data;
      if (data?.type === 'studio:compose-result' && data.projectId === projectId && data.requestId === requestId) finish(data.accepted === true);
    };
    const timeout = setTimeout(() => finish(false), 5000);
    window.addEventListener('message', receive);
    window.parent.postMessage({ type: 'studio:compose', projectId, requestId, text, ...(preparationId ? { preparationId } : {}) }, window.location.origin);
  });
}

/** Choose/reveal chat before capturing or uploading visual feedback. */
export function prepareHostFeedback(projectId: string): Promise<string | null> {
  if (window.parent === window) return Promise.resolve(null);
  const requestId = crypto.randomUUID();
  return new Promise(resolve => {
    const finish = (accepted: boolean) => { clearTimeout(timeout); window.removeEventListener('message', receive); resolve(accepted ? requestId : null); };
    const receive = (event: MessageEvent) => {
      if (event.origin !== window.location.origin || event.source !== window.parent) return;
      const data = event.data;
      if (data?.type === 'studio:feedback-prepared' && data.projectId === projectId && data.requestId === requestId) finish(data.accepted === true);
    };
    const timeout = setTimeout(() => finish(false), 120_000);
    window.addEventListener('message', receive);
    window.parent.postMessage({ type: 'studio:prepare-feedback', projectId, requestId }, window.location.origin);
  });
}
