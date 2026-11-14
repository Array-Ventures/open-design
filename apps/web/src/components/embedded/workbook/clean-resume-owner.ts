import type { IWorkbookData } from '@univerjs/core';
import { isIssuedWorkbookMembershipWriterLease, type WorkbookMembershipWriterLease } from './membership-writer-lease';
import type { WorkbookSheetHistoryController } from './sheet-history-controller';

interface Calculation {
  readonly inputEpoch: number;
  readonly quiescent: boolean;
  freezeAuthoring(): () => void;
  awaitQuiescent(signal?: AbortSignal): Promise<void>;
}
interface Options {
  controller: WorkbookSheetHistoryController;
  calculation: Calculation;
  snapshot(): IWorkbookData;
  ownerCurrent(): boolean;
  qualified(): boolean;
  currentLease(): WorkbookMembershipWriterLease | null | undefined;
  setLease(lease: WorkbookMembershipWriterLease): void;
  resetKernel(): void;
}
/** Live kernel/Writer transfer only. The hook must separately confirm a
 * no-effect restore and preserve the exact same leased protected checkpoint. */
export function bindWorkbookCleanResumeOwner(initial: WorkbookMembershipWriterLease, options: Options): { dispose(): void; observeLease(next: WorkbookMembershipWriterLease | null | undefined): void } {
  if (!isIssuedWorkbookMembershipWriterLease(initial) || !initial.isOwned()) throw Error('The worksheet Writer lease was not issued by its editor.');
  let active = true, captured = false, replacementRequested = false;
  let lease = initial;
  let releaseCalculation = lease.bindCalculation(signal => options.calculation.awaitQuiescent(signal));
  let releaseResume = () => {};
  let discardCaptured: (() => void) | null = null;
  const observeReplacement = (next: WorkbookMembershipWriterLease | null | undefined) => {
    if (!active || captured || replacementRequested || !next || next === lease
      || !isIssuedWorkbookMembershipWriterLease(next) || !next.isOwned() || options.currentLease() !== next) return;
    replacementRequested = true; options.resetKernel();
  };
  const bind = (owner: WorkbookMembershipWriterLease) => owner.bindCleanResume(async signal => {
    if (!active || captured || lease !== owner || !owner.isQualified() || !options.qualified()) return null;
    // Stop authored changes before draining already admitted derived results.
    const unfreeze = options.calculation.freezeAuthoring();
    let resumeHistory = () => {};
    try {
      resumeHistory = options.controller.pauseHistory();
      await options.calculation.awaitQuiescent(signal);
      // History has withdrawn operational admission. Drain any already-running
      // retirement through its commit/rollback and controller cleanup before
      // capturing a checkpoint; this starts no maintenance or save work.
      await options.controller.settleMaintenance();
      if (signal.aborted || !active || lease !== owner || !owner.isQualified() || !options.qualified()) throw Error('The worksheet pause owner changed.');
      owner.writer.update(options.snapshot());
      if (owner.writer.state().dirty || owner.writer.state().saving || owner.writer.state().error) throw Error('The worksheet is not clean.');
      const inputEpoch = options.calculation.inputEpoch;
      const rebind = options.controller.prepareCleanResume(options.qualified);
      captured = true;
      let captureLive = true;
      const discard = () => {
        if (!captureLive) return;
        captureLive = false; captured = false;
        signal.removeEventListener('abort', discard);
        if (discardCaptured === discard) discardCaptured = null;
        // A discarded ticket never reopens its old revoked kernel. Only a
        // genuinely issued replacement can request the normal rebuild.
        observeReplacement(options.currentLease());
      };
      discardCaptured = discard;
      signal.addEventListener('abort', discard, { once: true });
      if (signal.aborted) discard();
      return async next => {
        if (!captureLive || !active || !isIssuedWorkbookMembershipWriterLease(next) || !next.isQualified()
          || options.currentLease() !== next || next.scope.projectId !== owner.scope.projectId
          || next.scope.fileName !== owner.scope.fileName || next.scope.viewerId !== owner.scope.viewerId
          || next.scope.draftId !== owner.scope.draftId) { discard(); throw Error('The worksheet resume lease does not match its kernel.'); }
        try {
          await options.calculation.awaitQuiescent();
          if (!captureLive || !active || options.currentLease() !== next || !next.isQualified() || !options.calculation.quiescent
            || options.calculation.inputEpoch !== inputEpoch) throw Error('The worksheet calculation changed during History.');
          options.setLease(next);
          rebind(next.writer);
          // Only the proved cache presentation may refresh desired. The source,
          // acknowledged snapshot/binding and retained pools remain unchanged.
          next.writer.update(options.snapshot());
          if (next.writer.state().dirty || next.writer.state().saving || next.writer.state().error) throw Error('The resumed worksheet is not clean.');
          lease = next;
          releaseCalculation(); releaseResume();
          releaseCalculation = next.bindCalculation(signal => options.calculation.awaitQuiescent(signal));
          releaseResume = bind(next);
          captureLive = false; captured = false;
          signal.removeEventListener('abort', discard);
          if (discardCaptured === discard) discardCaptured = null;
          unfreeze(); resumeHistory();
        } catch (error) { discard(); next.withdraw(); throw error; }
      };
    } catch (error) {
      // A refused capture may return to the exact still-live owner. A revoked
      // owner must remain frozen until its kernel is disposed/recovered.
      if (active && lease === owner && owner.isQualified() && options.ownerCurrent()) { unfreeze(); resumeHistory(); }
      throw error;
    }
  });
  releaseResume = bind(lease);
  return {
    dispose() { active = false; discardCaptured?.(); releaseResume(); releaseCalculation(); },
    observeLease(next) {
      // Only a privately captured handoff can retain native issuers. A normal
      // replacement must rebuild the kernel instead of silently disabling its
      // old controller or attaching it to an arbitrary new Writer.
      observeReplacement(next);
    },
  };
}
