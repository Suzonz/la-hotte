'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { getSupabase } from './supabase/client';
import { makeActions } from './actions';
import { fetchAll, humanError } from './data';
import { derive, type Derived } from './derive';
import type { HotteData } from './types';

// The app's state: what this user may see (data.ts), what is computed from it
// (derive.ts), and everything they can do (actions.ts).
export type { SantaForm } from './actions';
export type { Derived } from './derive';

type RunResult = { ok: boolean };
type RunFn = <T>(fn: () => Promise<T>, okMsg?: string | ((r: T) => string)) => Promise<RunResult>;
type Ctx = {
  me: string;
  data: HotteData;
  d: Derived;
  busy: boolean;
  toast: (msg: string) => void;
  reload: () => Promise<void>;
  actions: ReturnType<typeof makeActions>;
  run: RunFn;
};
const HotteContext = createContext<Ctx | null>(null);
export const useHotte = () => {
  const ctx = useContext(HotteContext);
  if (!ctx) throw new Error('useHotte outside HotteProvider');
  return ctx;
};

export function HotteProvider({ me, children }: { me: string; children: React.ReactNode }) {
  const [data, setData] = useState<HotteData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const toast = useCallback((msg: string) => {
    setToastMsg(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToastMsg(null), 4000);
  }, []);

  const reload = useCallback(async () => {
    try { setData(await fetchAll()); setLoadError(null); }
    catch (e) { setLoadError(humanError(e)); }
  }, []);

  useEffect(() => {
    reload();
    // Other people change things too. Live: any change on our tables triggers a
    // reload (a short pause groups a burst of changes into one). The data itself
    // still comes from fetchAll, so the privacy rules apply as usual.
    let pending: ReturnType<typeof setTimeout> | undefined;
    const soon = () => { clearTimeout(pending); pending = setTimeout(reload, 400); };
    const channel = getSupabase()
      .channel('la-hotte-changes')
      .on('postgres_changes', { event: '*', schema: 'public' }, soon)
      .subscribe();
    // Safety nets if the live connection drops: when the tab comes back, and every 5 minutes.
    const onFocus = () => { if (document.visibilityState === 'visible') reload(); };
    document.addEventListener('visibilitychange', onFocus);
    window.addEventListener('focus', onFocus);
    const timer = setInterval(onFocus, 5 * 60_000);
    return () => {
      clearTimeout(pending);
      getSupabase().removeChannel(channel);
      document.removeEventListener('visibilitychange', onFocus); window.removeEventListener('focus', onFocus); clearInterval(timer);
    };
  }, [reload]);

  const d = useMemo(() => (data ? derive(data, me) : null), [data, me]);
  const latest = useRef<{ me: string; d: Derived } | null>(null);
  latest.current = d ? { me, d } : null;
  const actions = useMemo(() => makeActions(() => latest.current as { me: string; d: Derived }), []);

  // Wraps every action: one at a time, error → toast, success → reload (+ toast).
  const running = useRef(false);
  const run = useCallback<RunFn>(async (fn, okMsg) => {
    if (running.current) return { ok: false };
    running.current = true; setBusy(true);
    try {
      const r = await fn();
      await reload();
      if (okMsg) toast(typeof okMsg === 'function' ? okMsg(r) : okMsg);
      return { ok: true };
    } catch (e) {
      toast(humanError(e));
      await reload();
      return { ok: false };
    } finally {
      running.current = false; setBusy(false);
    }
  }, [reload, toast]);

  if (loadError && !data) return <div className="wrap pb-24"><div className="error-banner">{loadError}</div></div>;
  if (!data || !d) return <div className="wrap pb-24"><div className="empty">Chargement des listes…</div></div>;

  return (
    <HotteContext.Provider value={{ me, data, d, busy, toast, reload, actions, run }}>
      {children}
      {toastMsg && <div className="toast" role="status">{toastMsg}</div>}
    </HotteContext.Provider>
  );
}
