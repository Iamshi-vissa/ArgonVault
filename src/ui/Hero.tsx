import { lazy, Suspense, useEffect, useRef, useState, type ReactNode } from 'react';
import ParticleText from '../rb/ParticleText';
import { PALETTE, useTheme } from './useTheme';

// The WebGPU shards (and their library) load after the page is up, and only where they'll show.
const AeroShards = lazy(() => import('../rb/AeroShards'));
const IDLE_PAUSE_MS = 10_000;
const SCROLL_PAUSE_PX = 8;

/**
 * The opening band: the wordmark assembles from particles while olive glass
 * shards drift behind it. Without WebGPU the shards are simply left out.
 */
export default function Hero({ children }: { children: ReactNode }) {
  const theme = useTheme();
  const c = PALETTE[theme];
  const [gpu, setGpu] = useState(true);
  // The shards are skipped on narrow screens, where they'd sit behind the text and cost battery.
  const [wide, setWide] = useState(() => window.matchMedia?.('(min-width: 720px)').matches ?? true);
  useEffect(() => {
    const m = window.matchMedia?.('(min-width: 720px)');
    const on = () => setWide(m.matches);
    m?.addEventListener?.('change', on);
    return () => m?.removeEventListener?.('change', on);
  }, []);

  // The shards are expensive to draw, so they only animate while the page is at the top and someone is
  // moving the pointer over it. They pause as soon as the page scrolls (so scrolling never waits on the
  // GPU) and after 10 s without pointer activity (to save battery).
  const [idle, setIdle] = useState(false);
  const [scrolled, setScrolled] = useState(() => window.scrollY > SCROLL_PAUSE_PX);
  const idleTimer = useRef(0);
  const wake = () => {
    if (idle) setIdle(false);
    window.clearTimeout(idleTimer.current);
    idleTimer.current = window.setTimeout(() => setIdle(true), IDLE_PAUSE_MS);
  };
  useEffect(() => {
    idleTimer.current = window.setTimeout(() => setIdle(true), IDLE_PAUSE_MS + 4000); // let the intro finish first
    let frame = 0;
    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        setScrolled(window.scrollY > SCROLL_PAUSE_PX);
      });
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.clearTimeout(idleTimer.current);
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', onScroll);
    };
  }, []);
  const paused = idle || scrolled;

  return (
    <header className="hero" onPointerMove={wake} onPointerDown={wake}>
      {gpu && wide && (
        <div className="hero-shards" aria-hidden="true">
          <Suspense fallback={null}>
            <AeroShards
              paused={paused}
              mouseInteraction={!paused}
              key={theme}
              lightMode={theme === 'light'}
              shardColor={theme === 'dark' ? c.beige : c.olive}
              accentColor={theme === 'dark' ? c.olive : c.sage}
              placement="right"
              material="glass"
              count={480}
              shardSize={1.1}
              speed={0.55}
              glow={theme === 'dark' ? 0.3 : 0}
              grain={0.04}
              vignette={0}
              markers="plus"
              mouseStrength={0.45}
              pulseOnClick={false}
              holdToGather={false}
              parallax={0.35}
              dpr={1.25}
              onError={() => setGpu(false)}
            />
          </Suspense>
        </div>
      )}
      <div className="hero-inner">
        <h1 className="wordmark">
          <ParticleText
            text="ArgonVault"
            fontFamily="'Bodoni Moda', Didot, Georgia, serif"
            fontWeight={800}
            fontSize="clamp(56px, 10vw, 124px)"
            color="currentColor"
            highlightColor={c.brass}
            particleSize={2.2}
            density={3}
            intro="gather"
            scatter={150}
            gatherDuration={1500}
            stagger={500}
            pointerRepel={28}
            repelRadius={90}
            idleDrift={0}
            glow={theme === 'dark'}
            className="wordmark-canvas"
          />
        </h1>
        {children}
      </div>
    </header>
  );
}
