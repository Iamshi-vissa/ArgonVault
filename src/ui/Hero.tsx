import { useEffect, useState, type ReactNode } from 'react';
import AeroShards from '../rb/AeroShards';
import ParticleText from '../rb/ParticleText';
import { PALETTE, useTheme } from './useTheme';

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

  return (
    <header className="hero">
      {gpu && wide && (
        <div className="hero-shards" aria-hidden="true">
          <AeroShards
            key={theme}
            lightMode={theme === 'light'}
            shardColor={theme === 'dark' ? c.beige : c.olive}
            accentColor={theme === 'dark' ? c.olive : c.sage}
            placement="right"
            material="glass"
            count={560}
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
            dpr={1.5}
            onError={() => setGpu(false)}
          />
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
