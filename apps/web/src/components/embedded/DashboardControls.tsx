import { useEffect, useRef, useState } from 'react';
import { RiSparklingLine, RiCalendarLine, RiMore2Fill, RiEditLine, RiPushpinLine, RiPushpinFill, RiArchiveLine, RiArrowGoBackLine, RiCloseLine } from '@remixicon/react';
import { Dropdown, DropdownTrigger, DropdownPopover, DropdownItem } from './boardui/dropdown';
import { Button, Input } from '@open-design/components';
import type { LiveArtifact } from '@open-design/contracts';
import { stageHostContext } from './host-context';
import { checkedDashboard, dashboardDetail } from './dashboards';
import styles from './DashboardControls.module.css';

/** Host metadata only. Archiving retains source files, exports and refresh history. */
export function DashboardControls({ artifact, onSaved }: { artifact: LiveArtifact; onSaved: (next: LiveArtifact) => void }) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(artifact.title);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const requestBot = async (kind: 'update' | 'schedule') => {
    if (busy || artifact.status === 'archived') return;
    setBusy(true); setError(null); setNotice(null);
    const assignment = kind === 'schedule'
      ? 'Set up recurring data updates. Use existing app tools and Evebot schedules. Ask for cadence/timezone and the data source only if they are not already known.'
      : 'Update the source data using the existing approved app tools, then refresh and verify the dashboard snapshot.';
    try {
      const accepted = await stageHostContext(artifact.projectId, `Load refreshing-dashboards. Dashboard: ${artifact.id}. Project: ${artifact.projectId}. ${assignment} Preserve valid data and the last successful preview on failure. Recheck access and archived state; do not widen visibility or grant connections.`);
      if (!accepted) throw new Error('The request could not be added to Evebot. Open the project in its conversation and try again.');
      if (mounted.current) setNotice('Draft added to chat. Send it there to continue.');
    } catch (cause) {
      if (mounted.current) setError(cause instanceof Error ? cause.message : 'Evebot request unavailable.');
    } finally { if (mounted.current) setBusy(false); }
  };
  const save = async (change: { title?: string; pinned?: boolean; archived?: boolean }) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/studio/projects/${artifact.projectId}/dashboards/${artifact.id}`, {
        method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(change),
      });
      if (!response.ok) throw new Error(`Dashboard update unavailable (${response.status}).`);
      const next = dashboardDetail(checkedDashboard(await response.json(), artifact.projectId));
      if (!mounted.current) return;
      onSaved(next);
      setEditing(false);
    } catch (cause) {
      if (mounted.current) setError(cause instanceof Error ? cause.message : 'Dashboard update unavailable.');
    } finally {
      if (mounted.current) setBusy(false);
    }
  };
  return <section aria-label="Dashboard settings" className={styles.controls} aria-busy={busy}>
    <div className={styles.actions}>
      <Button size="icon" aria-label="Update data with bot" title="Ask bot to update data" disabled={busy || artifact.status === 'archived'} onClick={() => { void requestBot('update'); }}><RiSparklingLine size={16} aria-hidden /></Button>
      <Button size="icon" aria-label="Schedule updates" title="Schedule updates" disabled={busy || artifact.status === 'archived'} onClick={() => { void requestBot('schedule'); }}><RiCalendarLine size={16} aria-hidden /></Button>
      <Dropdown>
        <DropdownTrigger aria-label="Dashboard actions" isDisabled={busy} className={styles.menuTrigger}><RiMore2Fill size={16} aria-hidden /></DropdownTrigger>
        <DropdownPopover aria-label="Dashboard actions" placement="bottom start">
          <DropdownItem onSelect={() => { setTitle(artifact.title); setEditing(true); }}><RiEditLine size={16} aria-hidden />Rename</DropdownItem>
          <DropdownItem onSelect={() => { void save({ pinned: !artifact.pinned }); }}>{artifact.pinned ? <RiPushpinFill size={16} aria-hidden /> : <RiPushpinLine size={16} aria-hidden />}{artifact.pinned ? 'Unpin' : 'Pin'}</DropdownItem>
          <DropdownItem onSelect={() => { void save({ archived: artifact.status !== 'archived' }); }}>{artifact.status === 'archived' ? <RiArrowGoBackLine size={16} aria-hidden /> : <RiArchiveLine size={16} aria-hidden />}{artifact.status === 'archived' ? 'Restore dashboard' : 'Archive dashboard'}</DropdownItem>
        </DropdownPopover>
      </Dropdown>
      {artifact.status === 'archived' ? <span className={styles.status}>Archived</span> : null}
    </div>
    {editing ? <form className={styles.actions} onSubmit={(event) => { event.preventDefault(); if (title.trim()) void save({ title: title.trim() }); }}>
      <Input aria-label="Dashboard title" value={title} maxLength={160} required disabled={busy} onChange={(event) => setTitle(event.target.value)} autoFocus />
      <Button size="sm" aria-label="Save title" type="submit" disabled={busy || !title.trim()}>Save</Button>
      <Button size="icon" aria-label="Cancel" title="Cancel" disabled={busy} onClick={() => setEditing(false)}><RiCloseLine size={16} aria-hidden /></Button>
    </form> : null}
    {notice ? <div role="status">{notice}</div> : null}
    {error ? <div role="alert">{error}</div> : null}
  </section>;
}
