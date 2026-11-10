'use client';

import dynamic from 'next/dynamic';

const Standard = dynamic(() => import('./standard-client-app').then((m) => m.StandardClientApp), { ssr: false });
const Studio = dynamic(async () => {
  const { installEmbeddedTransport } = await import('../../src/components/embedded/transport');
  installEmbeddedTransport();
  return import('../../src/components/embedded/EmbeddedStudio').then((m) => m.EmbeddedStudio);
}, { ssr: false });

/** Keep normal shell initialization out of embedded workspace sessions. */
export function ClientApp({ embedded = false }: { embedded?: boolean }) {
  return embedded ? <Studio /> : <Standard />;
}
