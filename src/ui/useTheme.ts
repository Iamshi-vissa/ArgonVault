import { useEffect, useState } from 'react';

export type Theme = 'light' | 'dark';

/** Follows data-theme on <html> when set (the Claude viewer sets it), otherwise the system setting. */
function read(): Theme {
  const forced = document.documentElement.dataset.theme;
  if (forced === 'light' || forced === 'dark') return forced;
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function useTheme(): Theme {
  const [theme, setTheme] = useState<Theme>(read);
  useEffect(() => {
    const update = () => setTheme(read());
    const media = window.matchMedia?.('(prefers-color-scheme: dark)');
    media?.addEventListener?.('change', update);
    const watch = new MutationObserver(update);
    watch.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => {
      media?.removeEventListener?.('change', update);
      watch.disconnect();
    };
  }, []);
  return theme;
}

/** Colours the canvas and WebGPU components need as literal values (they can't read CSS variables). */
export const PALETTE = {
  light: { ink: '#2b3118', olive: '#5b6a2a', sage: '#8f9a5c', beige: '#d9c9a3', brass: '#9a7b2f' },
  dark: { ink: '#ede4cc', olive: '#a9b865', sage: '#7d8a4a', beige: '#d8c79e', brass: '#d2b46a' }
} as const;
