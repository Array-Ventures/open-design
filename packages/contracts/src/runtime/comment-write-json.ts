/** Stable comment receipt identity across reconstructed targets and object key order. */
export function canonicalCommentJson(value: unknown): string {
  function ordered(item: unknown): unknown {
    if (Array.isArray(item)) return item.map(ordered);
    if (item && typeof item === 'object') return Object.fromEntries(Object.entries(item)
      .filter(([, child]) => child !== undefined)
      .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
      .map(([key, child]) => [key, ordered(child)]));
    return item;
  }
  const json = JSON.stringify(ordered(value));
  if (json === undefined) throw new TypeError('Comment receipt data must be JSON.');
  return json;
}
