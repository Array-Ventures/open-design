import { deckSlideExportSource } from '../../edit-mode/deck-background';
export interface DeckExportSelection { fileName: string; sourceSha256: string; sourceGeneration: string; sourcePath: string; index: number; count: number }
export function sourceOwnedDeckExportSelection(input: { fileName: string; source: string | null; proof: { text: string; sha256: string } | null; sourceGeneration: string; sourcePath?: string; runtimeCount: number; blocked: boolean }): DeckExportSelection | null {
  if (input.blocked || !input.source || !input.proof || input.proof.text !== input.source || !/^[a-f0-9]{64}$/.test(input.proof.sha256) || !input.sourceGeneration || !input.sourcePath || input.runtimeCount < 1 || input.runtimeCount > 200) return null;
  const mapped = deckSlideExportSource(input.source, input.sourcePath);
  if (!mapped || mapped.count !== input.runtimeCount) return null;
  const index = mapped.index;
  return { fileName: input.fileName, sourceSha256: input.proof.sha256, sourceGeneration: input.sourceGeneration, sourcePath: input.sourcePath, index, count: input.runtimeCount };
}
