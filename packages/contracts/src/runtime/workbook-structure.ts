/** A monotone retained-source identity map. Null entries are genuinely inserted
 * axes. This is not a cell serialization or permission grant. */
export interface WorkbookAxisProjection {
  readonly sourceCount: number;
  readonly targetCount: number;
  point(index: number): number | null;
  interval(start: number, end: number): [number, number] | null;
}
export const WORKBOOK_STRUCTURE_AXIS_BUDGET = 100_000;
export function workbookAxisProjection(sourceCount: number, origins: readonly (number | null)[], coordinateLimit: number): WorkbookAxisProjection {
  if (!Number.isSafeInteger(sourceCount) || sourceCount < 1 || sourceCount > coordinateLimit || !origins.length || origins.length > coordinateLimit || sourceCount > WORKBOOK_STRUCTURE_AXIS_BUDGET || origins.length > WORKBOOK_STRUCTURE_AXIS_BUDGET) throw new Error('Structural axis exceeds its limit.');
  const retained: number[] = [], target: number[] = [], positions = new Map<number, number>();
  let previous = -1;
  for (const [index, origin] of origins.entries()) {
    if (origin === null) continue;
    if (!Number.isSafeInteger(origin) || origin < 0 || origin >= sourceCount || origin <= previous) throw new Error('Structural identity must be unique and ordered.');
    previous = origin; retained.push(origin); target.push(index); positions.set(origin, index);
  }
  const valid = (index: number) => {
    if (!Number.isSafeInteger(index) || index < 0 || index >= coordinateLimit) throw new Error('Structural reference is outside its axis.');
  };
  const point = (index: number) => {
    valid(index);
    const next = index >= sourceCount ? index + origins.length - sourceCount : positions.get(index) ?? null;
    if (next !== null && next >= coordinateLimit) throw new Error('Structural reference exceeds the worksheet limit.');
    return next;
  };
  const lower = (needle: number) => { let left = 0, right = retained.length; while (left < right) { const middle = (left + right) >>> 1; if (retained[middle]! < needle) left = middle + 1; else right = middle; } return left; };
  return { sourceCount, targetCount: origins.length, point, interval(start, end) {
    valid(start); valid(end); if (end < start) throw new Error('Structural range endpoints are reversed.');
    const first = lower(start), last = lower(end + 1) - 1;
    // References beyond the materialized grid remain valid Excel coordinates;
    // they shift by the same insertion/deletion delta, never become invented rows.
    const low = first <= last ? target[first]! : end >= sourceCount ? point(Math.max(start, sourceCount)) : null;
    const high = end >= sourceCount ? point(end) : first <= last ? target[last]! : null;
    return low === null || high === null ? null : [low, high];
  } };
}
