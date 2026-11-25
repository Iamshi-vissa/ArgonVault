import { useEffect, useRef, useState } from 'react';
import Landing from './Landing';
import Tool, { type Mode, type Result } from './Tool';
import { useSession } from './ui/useSession';

/**
 * Two pages, routed on the address's #fragment so the app stays one static
 * file: #lock and #unlock open the tool, anything else is the landing page
 * (where #about, #how and #details jump to sections).
 */
type Route = { page: 'landing'; anchor: string } | { page: 'tool'; mode: Mode };

function readRoute(): Route {
  const h = location.hash.replace(/^#/, '');
  if (h === 'lock' || h === 'unlock') return { page: 'tool', mode: h };
  return { page: 'landing', anchor: h };
}

export default function App() {
  const [route, setRoute] = useState<Route>(readRoute);
  const session = useSession<Result>();
  // Whether the tool was reached from the landing page in this tab, so Back can return to the same spot.
  const fromLanding = useRef(false);
  const previous = useRef<Route['page']>(route.page);
  if (previous.current !== route.page) {
    fromLanding.current = previous.current === 'landing' && route.page === 'tool';
    previous.current = route.page;
  }

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
  const key = route.page === 'tool' ? 'tool' : `landing:${route.anchor}`;
  useEffect(() => {
    document.title = route.page === 'tool' ? `ArgonVault: ${route.mode === 'lock' ? 'Lock' : 'Unlock'}` : 'ArgonVault';
    if (route.page === 'landing' && route.anchor) {
      requestAnimationFrame(() => {
        const target = document.getElementById(route.anchor);
        if (target) target.scrollIntoView({ block: 'start' });
        else window.scrollTo(0, 0);
      });
    } else {
      window.scrollTo(0, 0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  if (route.page === 'tool')
    return <Tool mode={route.mode} onMode={m => location.replace(`#${m}`)} onBack={back} session={session} />;
  return <Landing />;
}
