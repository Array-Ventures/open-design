'use client';

import { workbookExportBridge, type WorkbookExportScope } from './grid-export';
import { attachCsvLiteralInput } from './csv-literal-input';

import { useEffect, useRef, useState } from 'react';
import { CommandType, IContextService, FUniver, LocaleType, Univer, type IRange, type IWorkbookData } from '@univerjs/presets';
import English from '@univerjs/preset-sheets-core/locales/en-US';
import '@univerjs/preset-sheets-core/lib/index.css';
import type { WorkbookDocument } from '@open-design/contracts/runtime/workbook';
import { gridWorkbook, type WorkbookDisplayGap } from './grid-model';
import { workbookGridTheme } from './grid-theme';
import styles from './WorkbookGrid.module.css';
import { cx } from '../boardui/cx';
import { workbookFormattingBridge, type WorkbookFormatScope } from './grid-format';
import type { WorkbookCalculationState } from './calculation-state';
import { ownWorkbookCalculationWorker } from './calculation-worker-owner';
import { attachWorkbookCalculation, workbookLiveCalculationEligible } from './grid-calculation';
import { ownArrayProjectionWorker } from './array-projection-owner';
import { attachWorkbookArrayCalculation } from './grid-array-calculation';
import { prepareWorkbookArrayLiveSource } from './array-live-source';
import { restoreCsvViewDimensions } from './csv-view-dimensions';
import { restoreWorkbookSelection } from './grid-selection';
import { LifecycleService, LifecycleStages } from '@univerjs/core';
import { WorkbookViewLayers } from './grid-view-layers';

export interface WorkbookGridProps {
  id: string; title: string; model: WorkbookDocument; sourceSha256?: string;
  initialSnapshot?: IWorkbookData;
  formatScope?: WorkbookFormatScope;
  exportScope?: WorkbookExportScope;
  onSnapshot?(snapshot: IWorkbookData): void;
  onReady?(snapshot: IWorkbookData): void | Promise<void>;
  onDisplayGaps?(gaps: WorkbookDisplayGap[]): void;
}

/** A disposable spreadsheet UI, never an XLSX serializer. A surface must supply
 * its durable edit controller before edits are enabled. Refresh/theme changes
 * do not recreate the grid unless the acknowledged source model changes. */
export function WorkbookGrid({ id, title, model, sourceSha256, initialSnapshot, onSnapshot, onReady, onDisplayGaps, formatScope, exportScope }: WorkbookGridProps) {
  const container = useRef<HTMLDivElement>(null), callbacks = useRef({ id, model, title, onSnapshot, onReady, onDisplayGaps });
  const views = useRef<WorkbookViewLayers | null>(null);
  const viewScope = useRef(id);
  callbacks.current = { id, model, title, onSnapshot, onReady, onDisplayGaps };
  const view = useRef<{ id: string; sourceFormat: WorkbookDocument['sourceFormat']; sheetId: string; snapshot: IWorkbookData; range?: IRange } | null>(null);
  const restored = useRef(initialSnapshot);
  const format = useRef(formatScope); format.current = formatScope;
  const exportCurrent = useRef(exportScope); exportCurrent.current = exportScope;
  const exportBridge = useRef<{ publish(): void } | null>(null);
  useEffect(() => { exportBridge.current?.publish(); }, [exportScope?.blocked, exportScope?.sourceSha256]);
  const formattingRef = useRef<{ publish(): void } | null>(null);
  useEffect(() => { formattingRef.current?.publish(); }, [formatScope?.blocked]);
  const [error, setError] = useState<string | null>(null);
  const inputError = useRef<string | null>(null);
  const calculationState = useRef<WorkbookCalculationState | null>(null);
  const publishCalculation = () => {
    const scope = format.current, state = calculationState.current;
    if (scope && state) window.parent.postMessage({ type: 'studio:workbook-calculation-state', projectId: scope.projectId, controllerId: scope.controllerId, ...state }, window.location.origin);
  };
  const publishInput = () => {
    const scope = format.current;
    if (model.sourceFormat === 'csv' && scope) window.parent.postMessage({ type: 'studio:workbook-input-state', projectId: scope.projectId, controllerId: scope.controllerId, error: inputError.current }, window.location.origin);
  };
  const reportInputError = (message: string | null) => { inputError.current = message ? message.slice(0, 1000) : null; publishInput(); };
  const publishState = () => { publishCalculation(); publishInput(); };
  const publish = useRef(publishState); publish.current = publishState;
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (event.source === window.parent && event.origin === window.location.origin && event.data?.type === 'studio:artifact-request' && event.data.projectId === format.current?.projectId) publish.current();
    };
    const scope = format.current, csv = model.sourceFormat === 'csv';
    window.addEventListener('message', receive); publish.current();
    return () => { window.removeEventListener('message', receive); if (csv && scope) window.parent.postMessage({ type: 'studio:workbook-input-state', projectId: scope.projectId, controllerId: scope.controllerId, error: null }, window.location.origin); };
  }, [formatScope?.projectId, formatScope?.controllerId, model.sourceFormat]);
  const [kernel, setKernel] = useState(0);
  const stored = useRef<WorkbookDocument | null>(null);
  const carried = useRef<{ id: string; model: WorkbookDocument; snapshot: IWorkbookData } | null>(null);
  const editable = Boolean(onSnapshot);
  useEffect(() => {
    if (!container.current) return;
    reportInputError(null);
    calculationState.current = null;
    const root = document.documentElement;
    let dispose = () => {}, active = true;
    // Crossing artifact identity withdraws old content synchronously, even if
    // the next lazy import or source preparation never completes.
    if (viewScope.current !== id) { views.current?.dispose(); views.current = null; viewScope.current = id; }
    const current = () => active && callbacks.current.id === id && callbacks.current.model === model;
    const close = () => { const owned = dispose; dispose = () => {}; owned(); };
    const start = async () => {
    try {
      // UI plugins are browser-only and form a lazy chunk. In particular, do
      // not initialize a late module load after the viewer/session unmounts.
      const kernel = await import('@univerjs/preset-sheets-core');
      const { DISABLE_AUTO_FOCUS_KEY, CalculationMode, UniverDocsPlugin, UniverDocsUIPlugin, UniverFormulaEnginePlugin, UniverRenderEnginePlugin, UniverSheetsPlugin, UniverSheetsUIPlugin, UniverSheetsFormulaPlugin, UniverSheetsFormulaUIPlugin, UniverSheetsNumfmtPlugin, UniverSheetsNumfmtUIPlugin, UniverUIPlugin } = kernel;
      if (!current() || !container.current) return;
      const theme = workbookGridTheme(root), prepared = gridWorkbook(model, id, callbacks.current.title, theme.gray[900]);
      const layers = views.current && !views.current.closed ? views.current : (views.current = new WorkbookViewLayers(container.current));
      const layer = layers.begin();
      dispose = () => layer.retire();
      const univer = new Univer({ locale: LocaleType.EN_US, locales: { [LocaleType.EN_US]: English }, theme, darkMode: root.dataset.theme === 'dark' });
      // The original model is the only authority for loaded formula caches.
      const original = structuredClone(prepared.data) as IWorkbookData;
      let calculationOwner: ReturnType<typeof ownWorkbookCalculationWorker> | null = null;
      let readyForInput = false;
      let arrayOwner: ReturnType<typeof ownArrayProjectionWorker> | null = null;
      const stopCalculation = () => { const owned = calculationOwner; calculationOwner = null; owned?.dispose(); const arrays = arrayOwner; arrayOwner = null; arrays?.dispose(); };
      let readSnapshot: (() => IWorkbookData) | undefined;
      const fallback = () => {
        if (!current()) return;
        stored.current = model;
        if (readSnapshot) {
          const snapshot = readSnapshot();
          callbacks.current.onSnapshot?.(snapshot);
          carried.current = { id, model, snapshot };
          setKernel(value => value + 1);
        }
      };
      // Own every instance before an asynchronous startup or plugin setup.
      layer.own(() => { stopCalculation(); univer.dispose(); });
      dispose = () => { stopCalculation(); layer.retire(); };
      const recovered = carried.current?.id === id && carried.current.model === model ? carried.current.snapshot : undefined;
      const sourceSeed = recovered ?? restored.current ?? original;
      const arraySeed = prepareWorkbookArrayLiveSource(model, original, sourceSha256, recovered ?? restored.current);
      if (arraySeed && stored.current !== model) {
        try { arrayOwner = ownArrayProjectionWorker(model, id, sourceSha256!, fallback); if (!await arrayOwner.loaded || !arrayOwner.ready) { arrayOwner.dispose(); arrayOwner = null; stored.current = model; } }
        catch { arrayOwner?.dispose(); arrayOwner = null; stored.current = model; }
      }
      if (!arraySeed && model.sourceFormat !== 'csv' && stored.current !== model && workbookLiveCalculationEligible(model, sourceSeed)) {
        try {
          calculationOwner = ownWorkbookCalculationWorker(fallback);
          if (!await calculationOwner.loaded || !calculationOwner.ready) { calculationOwner.dispose(); calculationOwner = null; stored.current = model; }
        } catch { calculationOwner?.dispose(); calculationOwner = null; stored.current = model; }
      }
      if (!current()) { close(); return; }
      if (calculationOwner) {
        const { UniverRPCMainThreadPlugin } = await import('@univerjs/rpc');
        if (!current()) { close(); return; }
        univer.registerPlugin(UniverRPCMainThreadPlugin, { workerURL: calculationOwner.worker });
      }
      univer.registerPlugin(UniverRenderEnginePlugin);
      univer.registerPlugin(UniverFormulaEnginePlugin, { notExecuteFormula: true });
      univer.registerPlugin(UniverUIPlugin, { container: layer.element, header: false, toolbar: false, contextMenu: false, disableAutoFocus: true });
      univer.registerPlugin(UniverDocsPlugin); univer.registerPlugin(UniverDocsUIPlugin); univer.registerPlugin(UniverSheetsPlugin, { notExecuteFormula: true });
      univer.registerPlugin(UniverSheetsUIPlugin, { formulaBar: model.sourceFormat !== 'csv', footer: { sheetBar: model.sourceFormat !== 'csv', statisticBar: false, menus: false, zoomSlider: true, addSheetButtonConfig: { show: false } } });
      // In this pin the sheets flag routes function registration through RPC.
      // The engine flag above keeps stored mode inert without an RPC service.
      univer.registerPlugin(UniverSheetsFormulaPlugin, { notExecuteFormula: Boolean(calculationOwner), initialFormulaComputing: CalculationMode.NO_CALCULATION });
      univer.registerPlugin(UniverSheetsFormulaUIPlugin); univer.registerPlugin(UniverSheetsNumfmtPlugin, model.sourceFormat === 'csv' ? { disableTextFormatAlert: true, disableTextFormatMark: true } : undefined); univer.registerPlugin(UniverSheetsNumfmtUIPlugin);
      const univerAPI = FUniver.newAPI(univer);
      const previous = view.current?.id === id ? view.current : null;
      if (previous) for (const [sheetId, sheet] of Object.entries(prepared.data.sheets ?? {})) {
        const old = previous.snapshot.sheets[sheetId];
        if (old) {
          const position = { scrollTop: old.scrollTop, scrollLeft: old.scrollLeft, zoomRatio: old.zoomRatio };
          Object.assign(sheet, position);
          if (arraySeed?.sheets[sheetId]) Object.assign(arraySeed.sheets[sheetId]!, position);
          if (model.sourceFormat === 'csv' && previous.sourceFormat === 'csv') restoreCsvViewDimensions(sheet, old);
        }
      }
      const seed = recovered ?? restored.current; restored.current = undefined; carried.current = null;
      const workbook = univerAPI.createWorkbook(seed ? structuredClone(seed) : arraySeed ?? prepared.data);
      workbook.setActiveSheet(previous && prepared.data.sheets?.[previous.sheetId] ? previous.sheetId : seed?.sheetOrder[0] ?? prepared.activeSheetId); workbook.setEditable(false);
      readSnapshot = () => workbook.save();
      const calculationChanged = (value: WorkbookCalculationState) => { if (current()) { calculationState.current = value; publish.current(); } };
      const calculation = arraySeed ? attachWorkbookArrayCalculation(univer, univerAPI, model, original, workbook.save(), sourceSha256!, readSnapshot, arrayOwner, calculationChanged) : attachWorkbookCalculation(univer, univerAPI, model, original, workbook.save(), readSnapshot, calculationOwner, calculationChanged);
      dispose = () => {
        try { const sheet = workbook.getActiveSheet(); view.current = { id, sourceFormat: model.sourceFormat, sheetId: sheet.getSheetId(), snapshot: workbook.save(), range: sheet.getSelection()?.getActiveRange()?.getRange() }; }
        finally { workbook.setEditable(false); calculation.dispose(); stopCalculation(); layer.retire(); }
      };
      const selected = workbook.getActiveSheet();
      restoreWorkbookSelection(selected, previous?.range);
      // No mutations are accepted while the controller drains a previous
      // writer. An unmounted/revoked surface must never become editable later.
      await callbacks.current.onReady?.(workbook.save());
      if (!current()) return;
      // This pinned version uses disableAutoFocus for all editor focus, not
      // just startup. Enable it only after a person enters this grid so opening
      // an artifact cannot steal the chat composer's keyboard focus.
      const context = univer.__getInjector().get(IContextService), element = container.current;
      const activate = () => context.setContextValue(DISABLE_AUTO_FOCUS_KEY, !editable || !readyForInput);
      const release = () => context.setContextValue(DISABLE_AUTO_FOCUS_KEY, true);
      element.addEventListener('pointerdown', activate, true); element.addEventListener('focusin', activate);
      window.addEventListener('blur', release);
      const literal = model.sourceFormat === 'csv' ? attachCsvLiteralInput(univer, univerAPI, kernel, element, model, message => { if (current()) reportInputError(message || null); }) : null;
      const beforeLiteral = dispose;
      if (literal) dispose = () => { try { literal.dispose(); } finally { beforeLiteral(); } };
      const formatting = workbookFormattingBridge(univerAPI, () => {
        const scope = format.current;
        return editable && model.sourceFormat !== 'csv' && scope ? { ...scope, blocked: scope.blocked || !readyForInput } : undefined;
      }); formattingRef.current = formatting;
      const exporter = workbookExportBridge(univerAPI, () => {
        const scope = exportCurrent.current;
        return scope ? { ...scope, blocked: scope.blocked || !readyForInput } : undefined;
      }); exportBridge.current = exporter;
      const changed = univerAPI.addEvent(univerAPI.Event.CommandExecuted, event => {
        if (current() && event.type === CommandType.MUTATION && event.id.startsWith('sheet.')) { callbacks.current.onSnapshot?.(workbook.save()); formatting.publish(); }
      });
      let themeIdentity = JSON.stringify({ theme, dark: root.dataset.theme === 'dark' });
      const themes = new MutationObserver(() => {
        const theme = workbookGridTheme(root), dark = root.dataset.theme === 'dark', next = JSON.stringify({ theme, dark });
        if (next === themeIdentity) return;
        themeIdentity = next; univerAPI.setTheme(theme); univerAPI.toggleDarkMode(dark);
      });
      themes.observe(root, { attributes: true, attributeFilter: ['style', 'data-theme'] });
      dispose = () => {
        readyForInput = false;
        try {
          const sheet = workbook.getActiveSheet();
          view.current = { id, sourceFormat: model.sourceFormat, sheetId: sheet.getSheetId(), snapshot: workbook.save(), range: sheet.getSelection()?.getActiveRange()?.getRange() };
        } finally { element.removeEventListener('pointerdown', activate, true); element.removeEventListener('focusin', activate); window.removeEventListener('blur', release); themes.disconnect(); literal?.dispose(); exporter.dispose(); exportBridge.current = null; formatting.dispose(); formattingRef.current = null; changed.dispose(); calculation.dispose(); workbook.setEditable(false); stopCalculation(); layer.retire(); }
      };
      await univer.__getInjector().get(LifecycleService).onStage(LifecycleStages.Rendered);
      // The pinned UI releases its initial workbench skeleton two frames after
      // Rendered. Reveal only after that real layout/paint handoff completes.
      await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
      if (!current()) return;
      layer.show();
      readyForInput = true; workbook.setEditable(editable);
      formatting.publish(); exporter.publish();
      callbacks.current.onDisplayGaps?.(prepared.gaps); setError(null);
    } catch { close(); if (current()) setError('The workbook grid could not be opened.'); }
    };
    void start();
    return () => { active = false; close(); };
  }, [id, model, sourceSha256, editable, kernel]);
  // Run after the grid effect's cleanup has captured view state and detached
  // listeners. Disposing the kernel first would make workbook.save() invalid.
  useEffect(() => () => { views.current?.dispose(); views.current = null; }, []);
  return <div className="relative h-full min-h-0 w-full">
    <div ref={container} className={cx(styles.grid, 'h-full min-h-0 w-full')} role="region" aria-label="Workbook grid" tabIndex={0} />
    {error ? <div role="alert" className="absolute inset-0 bg-background-primary-default p-4 text-body-2-regular text-text-error-primary">{error}</div> : null}
  </div>;
}
