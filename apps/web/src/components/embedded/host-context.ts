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

export type HostArtifactFeedback = {
  filePath: string; kind: 'comment' | 'markup'; slideIndex?: number;
  selector?: string; label?: string; selectedText?: string;
};
export function commentFeedbackContext(items: ChatCommentAttachment[]): HostArtifactFeedback[] {
  return items.map(item => ({ filePath: item.filePath, kind: 'comment',
    ...(item.slideIndex !== undefined ? { slideIndex: item.slideIndex } : {}),
    ...(item.selector ? { selector: item.selector.slice(0, 2000) } : {}),
    ...(item.label ? { label: item.label.slice(0, 200) } : {}),
    ...(item.currentText ? { selectedText: item.currentText.slice(0, 4000) } : {}),
  }));
}
export function commentFeedbackNote(items: ChatCommentAttachment[]): string {
  return items.map(item => item.comment.trim()).filter(Boolean).join('\n\n') || 'Update the selected content.';
}

type HostReply = { requestId: string; accepted: boolean; error?: string };

function requestHost(projectId: string, type: string, responseType: string, fields: Record<string, unknown> = {}, requestId = crypto.randomUUID(), timeoutMs = 5000): Promise<HostReply> {
  if (window.parent === window) return Promise.resolve({ requestId, accepted: false });
  return new Promise(resolve => {
    const finish = (accepted: boolean, error?: string) => { clearTimeout(timeout); window.removeEventListener('message', receive); resolve({ requestId, accepted, ...(error ? { error } : {}) }); };
    const receive = (event: MessageEvent) => {
      if (event.origin !== window.location.origin || event.source !== window.parent) return;
      const data = event.data;
      if (data?.type === responseType && data.projectId === projectId && data.requestId === requestId) finish(data.accepted === true, typeof data.error === 'string' && data.error.length <= 400 ? data.error : undefined);
    };
    const timeout = setTimeout(() => finish(false), timeoutMs);
    window.addEventListener('message', receive);
    window.parent.postMessage({ type, projectId, requestId, ...fields }, window.location.origin);
  });
}

/** The host acknowledges staging into its normal composer, never agent execution. */
export async function stageHostContext(projectId: string, text: string, operationId?: string, preparationId?: string, imagePaths: string[] = [], feedback: HostArtifactFeedback[] = [], onFailure?: (message: string) => void): Promise<boolean> {
  if (!text.trim() || text.length > 32_000) return false;
  const result = await requestHost(projectId, 'studio:compose', 'studio:compose-result', { text, ...(preparationId ? { preparationId } : {}), ...(imagePaths.length ? { imagePaths } : {}), ...(feedback.length ? { feedback } : {}) }, operationId, 30_000);
  if (!result.accepted) onFailure?.(result.error ?? 'The feedback could not be added. Your draft is still available.');
  return result.accepted;
}

/** Bind a destination before capture/upload; its token accompanies the staged operation. */
export async function prepareHostFeedback(projectId: string): Promise<string | null> {
  const reply = await requestHost(projectId, 'studio:prepare-feedback', 'studio:feedback-prepared', {}, undefined, 120_000);
  return reply.accepted ? reply.requestId : null;
}

export async function confirmHostFeedbackDiscard(projectId: string, kind: 'comment' | 'markup'): Promise<boolean> {
  return (await requestHost(projectId, 'studio:confirm-feedback-discard', 'studio:feedback-discarded', { kind }, undefined, 120_000)).accepted;
}
