import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { applyHostTheme, parseHostTheme } from './host-theme';
import type { CollabCloudMemberDirectoryEntry } from '@open-design/contracts';

export type MentionBot = { id: string; name: string };
const MentionBots = createContext<readonly MentionBot[]>([]);
export const useEmbeddedMentionBots = () => useContext(MentionBots);

const Viewer = createContext<CollabCloudMemberDirectoryEntry | null>(null);
export const useEmbeddedViewer = () => useContext(Viewer);

export function EmbeddedViewerProvider({ projectId, children }: { projectId: string; children: ReactNode }) {
  const [viewer, setViewer] = useState<CollabCloudMemberDirectoryEntry | null>(null);
  const [bots, setBots] = useState<MentionBot[]>([]);
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (event.source !== window.parent || event.origin !== window.location.origin) return;
      const data = event.data;
      if (data?.type !== 'studio:host-context' || data.projectId !== projectId) return;
      if (typeof data.viewer?.id !== 'string' || data.viewer.id.length > 200 || typeof data.viewer.name !== 'string' || data.viewer.name.length > 200) return;
      const theme = parseHostTheme(data.theme, color => CSS.supports('color', color));
      if (theme) applyHostTheme(theme, document.documentElement);
      if (Array.isArray(data.mentionBots) && data.mentionBots.length <= 1000 && data.mentionBots.every((bot: MentionBot) => bot && typeof bot.id === 'string' && bot.id.length <= 200 && typeof bot.name === 'string' && bot.name.length > 0 && bot.name.length <= 200)) {
        setBots(data.mentionBots.map(({ id, name }: MentionBot) => ({ id, name })));
      }
      setViewer({ memberId: `evebot:${data.viewer.id}`, displayName: data.viewer.name, role: 'member' });
    };
    window.addEventListener('message', receive);
    if (window.parent !== window) window.parent.postMessage({ type: 'studio:ready', projectId }, window.location.origin);
    return () => window.removeEventListener('message', receive);
  }, [projectId]);
  return <Viewer.Provider value={viewer}><MentionBots.Provider value={bots}>{children}</MentionBots.Provider></Viewer.Provider>;
}
