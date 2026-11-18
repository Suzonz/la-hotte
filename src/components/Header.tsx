'use client';

import { useEffect, useState } from 'react';
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

export type Tab = { key: string; label: string; sep?: boolean };

export function Header({ tabs, current, onSelect }: { tabs: Tab[]; current?: string; onSelect?: (key: string) => void }) {
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
            {onSelect && <button className="btn ghost sm" onClick={signOut}>Se déconnecter</button>}
          </div>
        </div>
        {tabs.length > 0 && (
          <nav className="tabs" aria-label="Listes">
            {tabs.map(t => (
              <button key={t.key} className={'tab' + (t.sep ? ' sep' : '')} aria-current={current === t.key} onClick={() => onSelect?.(t.key)}>
                {t.label}
              </button>
            ))}
          </nav>
        )}
      </div>
    </header>
  );
}
