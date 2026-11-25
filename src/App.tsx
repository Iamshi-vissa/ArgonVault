import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import type { Mode, Result } from './tool/types';

// Each page is its own download, so the landing page doesn't wait for the tool (and vice versa).
const Landing = lazy(() => import('./Landing'));
const Tool = lazy(() => import('./tool/Tool'));
const Setup = lazy(() => import('./Setup'));
import { useSession } from './ui/useSession';

/**
 * Two pages, routed on the address's #fragment so the app stays one static
 * file: #lock and #unlock open the tool, anything else is the landing page
 * (where #about, #how and #details jump to sections).
 */
type Route = { page: 'landing'; anchor: string } | { page: 'tool'; mode: Mode } | { page: 'setup' };

function readRoute(): Route {
  const h = location.hash.replace(/^#/, '');
  if (h === 'lock' || h === 'unlock') return { page: 'tool', mode: h };
  if (h === 'setup') return { page: 'setup' };
  return { page: 'landing', anchor: h };
}

export default function App() {
  const [route, setRoute] = useState<Route>(readRoute);
  const session = useSession<Result>();
  // Whether the tool was reached from the landing page in this tab, so Back can return to the same spot.
  const fromLanding = useRef(false);
  const previous = useRef<Route['page']>(route.page);
  useEffect(() => {
    if (previous.current === route.page) return;
    fromLanding.current = previous.current === 'landing' && route.page === 'tool';
    previous.current = route.page;
  }, [route.page]);

  const back = () => {
    if (fromLanding.current) history.back();
    else location.hash = '';
  };

  useEffect(() => {
    const on = () => setRoute(readRoute());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);

  // Jump to the top of a new page, or to the section a landing link names.
  useEffect(() => {
    document.title =
      route.page === 'tool'
        ? `ArgonVault: ${route.mode === 'lock' ? 'Lock' : 'Unlock'}`
        : route.page === 'setup'
          ? 'ArgonVault: Setup'
          : 'ArgonVault';
    if (route.page === 'landing' && route.anchor) {
      requestAnimationFrame(() => {
        const target = document.getElementById(route.anchor);
        if (target) target.scrollIntoView({ block: 'start' });
        else window.scrollTo(0, 0);
      });
    } else {
      window.scrollTo(0, 0);
    }
  }, [route]);

  return (
    <Suspense fallback={<div className="page-loading" aria-busy="true" />}>
      {route.page === 'tool' ? (
        <Tool mode={route.mode} onMode={m => location.replace(`#${m}`)} onBack={back} session={session} />
      ) : route.page === 'setup' ? (
        <Setup />
      ) : (
        <Landing />
      )}
    </Suspense>
  );
}
