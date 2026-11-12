'use client';

import { useEffect, useRef, useState } from 'react';
import { CommandType, FUniver, LocaleType, Univer, type IWorkbookData } from '@univerjs/presets';
import English from '@univerjs/preset-sheets-core/locales/en-US';
import '@univerjs/preset-sheets-core/lib/index.css';
import type { WorkbookDocument } from '@open-design/contracts/runtime/workbook';
import { gridWorkbook, type WorkbookDisplayGap } from './grid-model';
import { workbookGridTheme } from './grid-theme';

export interface WorkbookGridProps {
  id: string; title: string; model: WorkbookDocument;
  onSnapshot?(snapshot: IWorkbookData): void;
  onDisplayGaps?(gaps: WorkbookDisplayGap[]): void;
}

/** A disposable spreadsheet UI, never an XLSX serializer. A surface must supply
 * its durable edit controller before edits are enabled. Refresh/theme changes
 * do not recreate the grid unless the acknowledged source model changes. */
export function WorkbookGrid({ id, title, model, onSnapshot, onDisplayGaps }: WorkbookGridProps) {
  const container = useRef<HTMLDivElement>(null), callbacks = useRef({ title, onSnapshot, onDisplayGaps });
  callbacks.current = { title, onSnapshot, onDisplayGaps };
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
      const { CalculationMode, UniverDocsPlugin, UniverDocsUIPlugin, UniverFormulaEnginePlugin, UniverRenderEnginePlugin, UniverSheetsPlugin, UniverSheetsUIPlugin, UniverSheetsFormulaPlugin, UniverSheetsFormulaUIPlugin, UniverSheetsNumfmtPlugin, UniverSheetsNumfmtUIPlugin, UniverUIPlugin } = await import('@univerjs/preset-sheets-core');
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
      const workbook = univerAPI.createWorkbook(prepared.data);
      workbook.setActiveSheet(prepared.activeSheetId); workbook.setEditable(editable);
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
      dispose = () => { themes.disconnect(); changed.dispose(); univer.dispose(); };
      callbacks.current.onDisplayGaps?.(prepared.gaps); setError(null);
    } catch { close(); if (active) setError('The workbook grid could not be opened.'); }
    };
    void start();
    return () => { active = false; close(); };
  }, [id, model, editable]);
  return <div className="relative h-full min-h-0 w-full">
    <div ref={container} className="h-full min-h-0 w-full" role="region" aria-label="Workbook grid" />
    {error ? <div role="alert" className="absolute inset-0 bg-background-primary-default p-4 text-body-2-regular text-text-error-primary">{error}</div> : null}
  </div>;
}
