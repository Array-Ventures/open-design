import { describe, expect, it } from 'vitest';
import { sourceOwnedDeckExportSelection } from '../src/components/embedded/deck-export';
const source = '<deck-stage><section class="slide">One</section><section class="slide">二</section></deck-stage>';
const input = { fileName: 'index.html', source, proof: { text: source, sha256: 'a'.repeat(64) }, sourceGeneration: 'generation-1', sourcePath: 'path-0-1', runtimeCount: 2, blocked: false };
describe('source-owned deck export intent', () => {
  it('maps stamped source identity rather than a runtime ordinal', () => {
    expect(sourceOwnedDeckExportSelection(input)).toMatchObject({ index: 1, count: 2, sourcePath: 'path-0-1', sourceGeneration: 'generation-1' });
  });
  it('withdraws unproven, changed, blocked, legacy and unsupported root selections', () => {
    for (const patch of [{ proof: null }, { source: source + ' ' }, { blocked: true }, { sourcePath: undefined }, { runtimeCount: 3 }, { sourceGeneration: '' }, { sourcePath: 'path-0-9' }]) expect(sourceOwnedDeckExportSelection({ ...input, ...patch })).toBeNull();
    const unsupported = '<deck-stage><img class="slide"></deck-stage>';
    expect(sourceOwnedDeckExportSelection({ ...input, source: unsupported, proof: { ...input.proof, text: unsupported }, sourcePath: 'path-0-0', runtimeCount: 1 })).toBeNull();
  });
});
