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

type HostReply = { requestId: string; accepted: boolean };

function requestHost(projectId: string, type: string, responseType: string, fields: Record<string, unknown> = {}, requestId = crypto.randomUUID(), timeoutMs = 5000): Promise<HostReply> {
  if (window.parent === window) return Promise.resolve({ requestId, accepted: false });
  return new Promise(resolve => {
    const finish = (accepted: boolean) => { clearTimeout(timeout); window.removeEventListener('message', receive); resolve({ requestId, accepted }); };
    const receive = (event: MessageEvent) => {
      if (event.origin !== window.location.origin || event.source !== window.parent) return;
      const data = event.data;
      if (data?.type === responseType && data.projectId === projectId && data.requestId === requestId) finish(data.accepted === true);
    };
    const timeout = setTimeout(() => finish(false), timeoutMs);
    window.addEventListener('message', receive);
    window.parent.postMessage({ type, projectId, requestId, ...fields }, window.location.origin);
  });
}

/** The host acknowledges staging into its normal composer, never agent execution. */
export async function stageHostContext(projectId: string, text: string, operationId?: string, preparationId?: string, imagePaths: string[] = []): Promise<boolean> {
  if (!text.trim() || text.length > 32_000) return false;
  return (await requestHost(projectId, 'studio:compose', 'studio:compose-result', { text, ...(preparationId ? { preparationId } : {}), ...(imagePaths.length ? { imagePaths } : {}) }, operationId, 30_000)).accepted;
}

/** Bind a destination before capture/upload; its token accompanies the staged operation. */
export async function prepareHostFeedback(projectId: string): Promise<string | null> {
  const reply = await requestHost(projectId, 'studio:prepare-feedback', 'studio:feedback-prepared', {}, undefined, 120_000);
  return reply.accepted ? reply.requestId : null;
}

export async function confirmHostFeedbackDiscard(projectId: string, kind: 'comment' | 'markup'): Promise<boolean> {
  return (await requestHost(projectId, 'studio:confirm-feedback-discard', 'studio:feedback-discarded', { kind }, undefined, 120_000)).accepted;
}
