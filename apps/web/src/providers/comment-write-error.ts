/** Safe fixed copy: never display an untrusted error body from artifact content. */
export class RootCommentWriteError extends Error {
  constructor(readonly status: number, readonly code?: string) {
    super(status === 409 ? 'This comment changed. Your draft is preserved.'
      : status === 404 || status === 410 ? 'This comment was deleted. Your draft is preserved.'
      : status === 403 ? 'You can no longer edit this comment. Your draft is preserved.'
      : status === 0 || status === 408 || status >= 500 ? 'Saving could not be confirmed. Retry to check it safely.'
      : 'The comment could not be saved. Your draft is preserved.');
  }
}
