import { HugeiconsIcon } from '@hugeicons/react';
import { FileLockedIcon, LockKeyholeOpenIcon, Note01Icon } from '@hugeicons/core-free-icons';
import AnimatedList, { type AnimatedListEntry } from '../rb/AnimatedList';
import type { Theme } from './useTheme';

export interface SessionEntry {
  id: number;
  action: 'locked' | 'unlocked';
  what: 'file' | 'note';
  name: string;
  size: number;
  seal: string;
  at: number;
}

const ago = (t: number, now: number) => {
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 45) return 'now';
  if (s < 3600) return `${Math.round(s / 60)}m`;
  return `${Math.round(s / 3600)}h`;
};

function bytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

/** Olive and beige values for the list's own theme variables. */
const LIST_VARS: Record<Theme, Record<string, string>> = {
  light: {
    '--al-frame': 'rgba(246, 241, 228, 0.9)',
    '--al-frame-edge': 'rgba(43, 49, 24, 0.12)',
    '--al-frame-highlight': 'rgba(255, 253, 247, 0.9)',
    '--al-frame-shadow': '0 18px 40px -24px rgba(43, 49, 24, 0.35)',
    '--al-tile': 'linear-gradient(180deg, #fffdf7 0%, #f3ecdb 100%)',
    '--al-tile-edge': 'rgba(43, 49, 24, 0.1)',
    '--al-tile-highlight': 'rgba(255, 255, 255, 0.9)',
    '--al-tile-shadow': '0 4px 10px -6px rgba(43, 49, 24, 0.3)',
    '--al-well': 'rgba(91, 106, 42, 0.12)',
    '--al-ink': '#2b3118',
    '--al-muted': 'rgba(43, 49, 24, 0.62)',
    '--al-thumb': 'rgba(43, 49, 24, 0.2)',
    '--al-ring': '#5b6a2a',
    '--al-ring-fill': 'rgba(91, 106, 42, 0.07)'
  },
  dark: {
    '--al-frame': 'rgba(37, 42, 24, 0.85)',
    '--al-frame-edge': 'rgba(237, 228, 204, 0.1)',
    '--al-frame-highlight': 'rgba(237, 228, 204, 0.06)',
    '--al-frame-shadow': '0 22px 44px -22px rgba(0, 0, 0, 0.7)',
    '--al-tile': 'linear-gradient(180deg, #353c22 0%, #2a301b 100%)',
    '--al-tile-edge': 'rgba(237, 228, 204, 0.08)',
    '--al-tile-highlight': 'rgba(237, 228, 204, 0.1)',
    '--al-tile-shadow': '0 4px 10px -4px rgba(0, 0, 0, 0.6)',
    '--al-well': 'rgba(169, 184, 101, 0.14)',
    '--al-ink': '#ede4cc',
    '--al-muted': 'rgba(237, 228, 204, 0.6)',
    '--al-thumb': 'rgba(237, 228, 204, 0.18)',
    '--al-ring': '#a9b865',
    '--al-ring-fill': 'rgba(169, 184, 101, 0.08)'
  }
};

export default function Session({
  entries,
  now,
  theme,
  onSelect,
  onClear
}: {
  entries: SessionEntry[];
  now: number;
  theme: Theme;
  onSelect: (e: SessionEntry) => void;
  onClear: () => void;
}) {
  const items: AnimatedListEntry[] = entries.map(e => ({
    id: e.id,
    icon: (
      <HugeiconsIcon
        icon={e.action === 'unlocked' ? LockKeyholeOpenIcon : e.what === 'note' ? Note01Icon : FileLockedIcon}
        size={18}
        strokeWidth={1.8}
      />
    ),
    title: e.what === 'note' ? (e.action === 'locked' ? 'Locked note' : 'Unlocked note') : e.name,
    description:
      e.action === 'locked'
        ? `Locked, ${bytes(e.size)}. Seal ${e.seal}`
        : `Opened, ${bytes(e.size)}. Seal ${e.seal}`,
    meta: ago(e.at, now)
  }));

  return (
    <section className="session" aria-labelledby="session-title">
      <div className="session-head">
        <h2 id="session-title">This session</h2>
        {entries.length > 0 && (
          <button type="button" className="link" onClick={onClear}>
            Clear list
          </button>
        )}
      </div>
      {entries.length === 0 ? (
        <p className="session-empty">
          Nothing yet. What you lock or open appears here until you close the page. Choose a locked item to save it
          again.
        </p>
      ) : (
        <>
          <AnimatedList
            items={items}
            onItemSelect={(_, i) => onSelect(entries[i])}
            selectOnHover={false}
            animation="pop"
            theme={theme}
            accentColor={theme === 'dark' ? '#a9b865' : '#5b6a2a'}
            width="100%"
            maxHeight={360}
            radius={12}
            style={LIST_VARS[theme]}
            className="session-list"
          />
          <p className="sub">
            Locked items can be saved again. Opened files aren’t kept in this list, so their contents aren’t held once you move on.
          </p>
        </>
      )}
    </section>
  );
}
