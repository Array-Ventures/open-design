export interface WorkbookCalculationState {
  phase: 'live' | 'pending' | 'stored' | 'unavailable';
  stored: number;
  unavailable: number;
  paused: boolean;
}
export function workbookCalculationState(summary: { pending: boolean; paused: boolean; stored: number; unavailable: number }): WorkbookCalculationState {
  return { phase: summary.pending ? 'pending' : summary.unavailable ? 'unavailable' : summary.stored ? 'stored' : 'live', stored: summary.stored, unavailable: summary.unavailable, paused: summary.paused };
}
