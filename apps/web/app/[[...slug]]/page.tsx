import { ClientApp } from './client-app';
import { connection } from 'next/server';
import { notFound } from 'next/navigation';

// The whole product is a client-driven SPA: project IDs and file paths are
// unbounded user input, so we route every URL through this single optional
// catch-all and let the existing client router (src/router.ts, which reads
// window.location at runtime) decide what to render.
//
// For `output: 'export'` we return a single empty `slug` so Next.js emits
// one shell HTML at out/index.html; the daemon's SPA fallback (see
// apps/daemon/src/server.ts) serves it for any unknown non-API path so deep
// links still hydrate to the right view.
export function generateStaticParams() {
  return [{ slug: [] }];
}

export default async function Page({ params }: { params: Promise<{ slug?: string[] }> }) {
  // Missing static font files must not become successful SPA documents.
  if (process.env.OD_EMBEDDED_STUDIO === '1' && (await params).slug?.[0] === 'fonts') notFound();
  // Embedded project IDs are live workspace state. Do not materialize an ISR
  // page per UUID inside the immutable deployed application directory.
  if (process.env.OD_EMBEDDED_STUDIO === '1') await connection();
  return <ClientApp embedded={process.env.OD_EMBEDDED_STUDIO === '1'} />;
}
