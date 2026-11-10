import { useEffect, useRef, useState } from 'react';
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
      if (mounted.current) setNotice('Request added to the Evebot composer. Send it there to continue.');
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
      <Button size="sm" disabled={busy || artifact.status === 'archived'} onClick={() => { void requestBot('update'); }}>Update data with bot</Button>
      <Button size="sm" disabled={busy || artifact.status === 'archived'} onClick={() => { void requestBot('schedule'); }}>Schedule updates</Button>
      <Button size="sm" disabled={busy} onClick={() => { setTitle(artifact.title); setEditing((open) => !open); }}>Rename</Button>
      <Button size="sm" disabled={busy} aria-pressed={artifact.pinned} onClick={() => { void save({ pinned: !artifact.pinned }); }}>{artifact.pinned ? 'Unpin' : 'Pin'}</Button>
      <Button size="sm" disabled={busy} onClick={() => { void save({ archived: artifact.status !== 'archived' }); }}>{artifact.status === 'archived' ? 'Restore dashboard' : 'Archive dashboard'}</Button>
      <span>{artifact.status === 'archived' ? 'Archived. Files and history are retained. Restore to preview or refresh.' : 'Archiving retains files and history and cancels pending refreshes.'}</span>
    </div>
    {editing ? <form className={styles.actions} onSubmit={(event) => { event.preventDefault(); if (title.trim()) void save({ title: title.trim() }); }}>
      <Input aria-label="Dashboard title" value={title} maxLength={160} required disabled={busy} onChange={(event) => setTitle(event.target.value)} autoFocus />
      <Button size="sm" type="submit" disabled={busy || !title.trim()}>Save title</Button>
      <Button size="sm" disabled={busy} onClick={() => setEditing(false)}>Cancel</Button>
    </form> : null}
    {notice ? <div role="status">{notice}</div> : null}
    {error ? <div role="alert">{error}</div> : null}
  </section>;
}
