import { useEffect, useState } from 'react';

/** Viewer/file layout preference; never a source edit or editor history entry. */
export function useDocumentPageWidth(memberId: string | undefined, projectId: string, fileName: string) {
  const key = JSON.stringify(['evebot:document-width', memberId ?? null, projectId, fileName]);
  const [value, setValue] = useState({ key, wide: false });
  useEffect(() => {
    let wide = false;
    try { wide = localStorage.getItem(key) === 'wide'; } catch { /* Layout remains usable without storage. */ }
    setValue({ key, wide });
  }, [key]);
  const wide = value.key === key && value.wide;
  const toggle = () => {
    const next = !wide;
    try { localStorage.setItem(key, next ? 'wide' : 'standard'); } catch { /* Keep this mounted preference in memory. */ }
    setValue({ key, wide: next });
  };
  return { wide, toggle };
}
