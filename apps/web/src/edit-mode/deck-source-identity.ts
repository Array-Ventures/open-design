export interface DeckSourceIdentity { sourcePath: string; sourceGeneration: string }
export interface DeckSlideState { active: number; count: number; sourcePath?: string; sourceGeneration?: string }

/** A WindowProxy survives srcdoc replacement. Only the active document's
 * generation may supply a source-backed editing identity. */
export function deckSourceIdentity(value: unknown, generation: string): DeckSourceIdentity | null {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !generation) return null;
  const message = value as Record<string, unknown>;
  if (message.sourceGeneration !== generation || typeof message.sourcePath !== 'string' || message.sourcePath.length > 500 || !/^path(?:-\d+)+$/.test(message.sourcePath)) return null;
  return { sourcePath: message.sourcePath, sourceGeneration: generation };
}

export function deckSlideStateFromMessage(value: unknown, generation?: string): DeckSlideState | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const message = value as Record<string, unknown>;
  if (message.type !== 'od:slide-state' || typeof message.active !== 'number' || !Number.isInteger(message.active) || message.active < 0 || typeof message.count !== 'number' || !Number.isInteger(message.count) || message.count < 0 || message.active >= Math.max(1, message.count)) return null;
  // A packet that names its document cannot fall back to legacy handling when
  // that document has been replaced. Legacy count/index packets have no edit identity.
  if (message.sourceGeneration !== undefined && message.sourceGeneration !== generation) return null;
  return { active: message.active, count: message.count, ...(generation ? deckSourceIdentity(message, generation) : null) };
}
