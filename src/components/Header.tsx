'use client';

import { useEffect, useRef, useState } from 'react';
import { daysToChristmas } from '@/lib/format';
import { getSupabase } from '@/lib/supabase/client';

export function Logo() {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true">
      <path d="M6 13h20v14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2z" fill="var(--berry)" />
      <rect x="4" y="9" width="24" height="5" rx="1.5" fill="var(--pine)" />
      <rect x="14.5" y="9" width="3" height="20" fill="var(--gold)" />
      <path d="M16 9c-2-5-8-5-7-1.5C9.6 9.4 13 9 16 9zm0 0c2-5 8-5 7-1.5C22.4 9.4 19 9 16 9z" fill="none" stroke="var(--gold)" strokeWidth="2" />
    </svg>
  );
}

export type MenuItem = { key: string; label: string; current?: boolean; accent?: boolean; onSelect: () => void };
/** A top tab: either a plain button (onSelect) or a drop-down (menu). */
export type Tab = { key: string; label: string; active: boolean; onSelect?: () => void; menu?: MenuItem[] };

export function Header({ tabs }: { tabs: Tab[] }) {
  const [days, setDays] = useState<number | null>(null);
  useEffect(() => setDays(daysToChristmas()), []);

  const signOut = async () => {
    await getSupabase().auth.signOut();
    window.location.href = '/login';
  };

  return (
    <header className="top">
      <div className="wrap">
        <div className="brandrow">
          <a className="brand" href="/"><Logo />La Hotte</a>
          <div className="row">
            {days != null && <span className="countdown">{days === 0 ? 'C’est Noël !' : `J-${days} avant Noël`}</span>}
            {tabs.length > 0 && <button className="btn ghost sm" onClick={signOut}>Se déconnecter</button>}
          </div>
        </div>
        {tabs.length > 0 && (
          <nav className="tabs" aria-label="Navigation">
            {tabs.map(t => (t.menu ? <MenuTab key={t.key} tab={t} /> : (
              <button key={t.key} className="tab" aria-current={t.active} onClick={t.onSelect}>{t.label}</button>
            )))}
          </nav>
        )}
      </div>
    </header>
  );
}

function MenuTab({ tab }: { tab: Tab }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', close); };
  }, [open]);

  return (
    <div className="menu-tab" ref={ref}>
      <button className="tab" aria-current={tab.active} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(o => !o)}>
        {tab.label} <span aria-hidden="true" className="caret">▾</span>
      </button>
      {open && (
        <ul className="menu" role="menu">
          {tab.menu!.map(item => (
            <li key={item.key} role="none">
              <button role="menuitem" className={(item.current ? 'current' : '') + (item.accent ? ' accent' : '')}
                onClick={() => { setOpen(false); item.onSelect(); }}>
                {item.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
