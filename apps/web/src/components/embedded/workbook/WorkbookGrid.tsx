'use client';

import { useEffect, useRef, useState } from 'react';
import { CommandType, IContextService, FUniver, LocaleType, Univer, type IRange, type IWorkbookData } from '@univerjs/presets';
import English from '@univerjs/preset-sheets-core/locales/en-US';
import '@univerjs/preset-sheets-core/lib/index.css';
import type { WorkbookDocument } from '@open-design/contracts/runtime/workbook';
import { gridWorkbook, type WorkbookDisplayGap } from './grid-model';
import { workbookGridTheme } from './grid-theme';

export interface WorkbookGridProps {
  id: string; title: string; model: WorkbookDocument;
  onSnapshot?(snapshot: IWorkbookData): void;
  onReady?(snapshot: IWorkbookData): void;
  onDisplayGaps?(gaps: WorkbookDisplayGap[]): void;
}

/** A disposable spreadsheet UI, never an XLSX serializer. A surface must supply
 * its durable edit controller before edits are enabled. Refresh/theme changes
 * do not recreate the grid unless the acknowledged source model changes. */
export function WorkbookGrid({ id, title, model, onSnapshot, onReady, onDisplayGaps }: WorkbookGridProps) {
  const container = useRef<HTMLDivElement>(null), callbacks = useRef({ title, onSnapshot, onReady, onDisplayGaps });
  callbacks.current = { title, onSnapshot, onReady, onDisplayGaps };
  const view = useRef<{ id: string; sheetId: string; snapshot: IWorkbookData; range?: IRange } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const editable = Boolean(onSnapshot);
  useEffect(() => {
    if (!container.current) return;
    const root = document.documentElement, prepared = gridWorkbook(model, id, callbacks.current.title);
    let dispose = () => {}, active = true;
    const close = () => { const owned = dispose; dispose = () => {}; owned(); };
    const start = async () => {
    try {
      // UI plugins are browser-only and form a lazy chunk. In particular, do
      // not initialize a late module load after the viewer/session unmounts.
      const { DISABLE_AUTO_FOCUS_KEY, CalculationMode, UniverDocsPlugin, UniverDocsUIPlugin, UniverFormulaEnginePlugin, UniverRenderEnginePlugin, UniverSheetsPlugin, UniverSheetsUIPlugin, UniverSheetsFormulaPlugin, UniverSheetsFormulaUIPlugin, UniverSheetsNumfmtPlugin, UniverSheetsNumfmtUIPlugin, UniverUIPlugin } = await import('@univerjs/preset-sheets-core');
      if (!active || !container.current) return;
      const theme = workbookGridTheme(root);
      const univer = new Univer({ locale: LocaleType.EN_US, locales: { [LocaleType.EN_US]: English }, theme, darkMode: root.dataset.theme === 'dark' });
      // Own the instance before plugin registration so failed setup also closes it.
      dispose = () => univer.dispose();
      univer.registerPlugin(UniverRenderEnginePlugin);
      univer.registerPlugin(UniverFormulaEnginePlugin, { notExecuteFormula: true });
      univer.registerPlugin(UniverUIPlugin, { container: container.current, header: false, toolbar: false, contextMenu: false, disableAutoFocus: true });
      univer.registerPlugin(UniverDocsPlugin); univer.registerPlugin(UniverDocsUIPlugin); univer.registerPlugin(UniverSheetsPlugin);
      univer.registerPlugin(UniverSheetsUIPlugin, { formulaBar: true, footer: { sheetBar: true, statisticBar: false, menus: false, zoomSlider: true, addSheetButtonConfig: { show: false } } });
      univer.registerPlugin(UniverSheetsFormulaPlugin, { initialFormulaComputing: CalculationMode.NO_CALCULATION });
      univer.registerPlugin(UniverSheetsFormulaUIPlugin); univer.registerPlugin(UniverSheetsNumfmtPlugin); univer.registerPlugin(UniverSheetsNumfmtUIPlugin);
      const univerAPI = FUniver.newAPI(univer);
      const previous = view.current?.id === id ? view.current : null;
      if (previous) for (const [sheetId, sheet] of Object.entries(prepared.data.sheets ?? {})) {
        const old = previous.snapshot.sheets[sheetId];
        if (old) Object.assign(sheet, { scrollTop: old.scrollTop, scrollLeft: old.scrollLeft, zoomRatio: old.zoomRatio });
      }
      const workbook = univerAPI.createWorkbook(prepared.data);
      workbook.setActiveSheet(previous && prepared.data.sheets?.[previous.sheetId] ? previous.sheetId : prepared.activeSheetId); workbook.setEditable(editable);
      const selected = workbook.getActiveSheet();
      if (previous?.range && previous.range.endRow < selected.getMaxRows() && previous.range.endColumn < selected.getMaxColumns()) selected.setActiveRange(selected.getRange(previous.range));
      callbacks.current.onReady?.(workbook.save());
      // This pinned version uses disableAutoFocus for all editor focus, not
      // just startup. Enable it only after a person enters this grid so opening
      // an artifact cannot steal the chat composer's keyboard focus.
      const context = univer.__getInjector().get(IContextService), element = container.current;
      const activate = () => context.setContextValue(DISABLE_AUTO_FOCUS_KEY, !editable);
      const release = () => context.setContextValue(DISABLE_AUTO_FOCUS_KEY, true);
      element.addEventListener('pointerdown', activate, true); element.addEventListener('focusin', activate);
      window.addEventListener('blur', release);
      const changed = univerAPI.addEvent(univerAPI.Event.CommandExecuted, event => {
        if (event.type === CommandType.MUTATION && event.id.startsWith('sheet.')) callbacks.current.onSnapshot?.(workbook.save());
      });
      let themeIdentity = JSON.stringify({ theme, dark: root.dataset.theme === 'dark' });
      const themes = new MutationObserver(() => {
        const theme = workbookGridTheme(root), dark = root.dataset.theme === 'dark', next = JSON.stringify({ theme, dark });
        if (next === themeIdentity) return;
        themeIdentity = next; univerAPI.setTheme(theme); univerAPI.toggleDarkMode(dark);
      });
      themes.observe(root, { attributes: true, attributeFilter: ['style', 'data-theme'] });
      dispose = () => {
        try {
          const sheet = workbook.getActiveSheet();
          view.current = { id, sheetId: sheet.getSheetId(), snapshot: workbook.save(), range: sheet.getSelection()?.getActiveRange()?.getRange() };
        } finally { element.removeEventListener('pointerdown', activate, true); element.removeEventListener('focusin', activate); window.removeEventListener('blur', release); themes.disconnect(); changed.dispose(); univer.dispose(); }
      };
      callbacks.current.onDisplayGaps?.(prepared.gaps); setError(null);
    } catch { close(); if (active) setError('The workbook grid could not be opened.'); }
    };
    void start();
    return () => { active = false; close(); };
  }, [id, model, editable]);
  return <div className="relative h-full min-h-0 w-full">
    <div ref={container} className="h-full min-h-0 w-full" role="region" aria-label="Workbook grid" tabIndex={0} />
    {error ? <div role="alert" className="absolute inset-0 bg-background-primary-default p-4 text-body-2-regular text-text-error-primary">{error}</div> : null}
  </div>;
}
