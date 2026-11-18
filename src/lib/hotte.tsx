'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { getSupabase } from './supabase/client';
import { byName, parseAmount, safeUrl } from './format';
import type { Claim, ClaimKind, Group, HotteData, Person, Wish, WishDraft } from './types';

// Everything here only reads what the database lets this user see (RLS):
// filtering below is about presentation, never about secrecy.

const num = (v: unknown) => (v == null ? null : Number(v));

export function derive(data: HotteData, me: string) {
  const personById = new Map(data.persons.map(p => [p.id, p]));
  const personByUser = new Map(data.persons.filter(p => p.user_id).map(p => [p.user_id as string, p]));
  const groupById = new Map(data.groups.map(g => [g.id, g]));
  const myPerson = personByUser.get(me) ?? null;

  const membersOf = (gid: string) => data.members.filter(m => m.group_id === gid);
  const isMember = (uid: string, gid: string) => data.members.some(m => m.group_id === gid && m.user_id === uid);
  const myGroups: Group[] = data.groups.filter(g => isMember(me, g.id)).sort((a, b) => byName(a.name, b.name));
  const myGroupIds = myGroups.map(g => g.id);

  const accountOf = (p: Person) => p.user_id ?? p.manager_id ?? '';
  const manages = (p: Person) => p.user_id === me || p.manager_id === me;
  const myKids = data.persons.filter(p => p.manager_id === me).sort((a, b) => byName(a.name, b.name));

  const groupsOfWish = (wishId: string) => data.wishGroups.filter(wg => wg.wish_id === wishId && groupById.has(wg.group_id)).map(wg => wg.group_id);
  const wishesOf = (personId: string) => data.wishes.filter(w => w.person_id === personId);
  const claimsOn = (wishId: string) => data.claims.filter(c => c.wish_id === wishId);
  const claimsFor = (personId: string) => data.claims.filter(c => c.recipient_id === personId);
  const myClaims = data.claims.filter(c => c.claimer_id === me);
  const commonGroups = (p: Person) => myGroups.filter(g => isMember(accountOf(p), g.id));

  /** A name for whoever made a claim; people outside my groups stay anonymous. */
  const whoName = (uid: string) => (uid === me ? 'toi' : personByUser.get(uid)?.name ?? 'quelqu’un d’un autre groupe');

  // People shown in the top bar: accounts I share a group with, my children,
  // and other people's children who have at least one envie I can see.
  const others = data.persons
    .filter(p => p.user_id !== me)
    .filter(p => p.user_id || p.manager_id === me || wishesOf(p.id).some(w => !w.removed) || myClaims.some(c => c.recipient_id === p.id))
    .sort((a, b) => (Number(manages(b)) - Number(manages(a))) || byName(a.name, b.name));

  return {
    me, myPerson, myGroups, myGroupIds, myKids, myClaims, others,
    personById, personByUser, groupById,
    membersOf, isMember, accountOf, manages, commonGroups,
    groupsOfWish, wishesOf, claimsOn, claimsFor, whoName,
  };
}
export type Derived = ReturnType<typeof derive>;

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

async function fetchAll(): Promise<HotteData> {
  const sb = getSupabase();
  const [p, g, m, w, wg, c] = await Promise.all([
    sb.from('persons').select('id, user_id, manager_id, name'),
    sb.from('groups').select('id, name, created_by, invite_code'),
    sb.from('group_members').select('group_id, user_id, added_by'),
    sb.from('wishes').select('*'),
    sb.from('wish_groups').select('wish_id, group_id'),
    sb.from('claims').select('*'),
  ]);
  const err = [p, g, m, w, wg, c].find(r => r.error)?.error;
  if (err) throw new Error(err.message);
  return {
    persons: p.data ?? [], groups: g.data ?? [], members: m.data ?? [],
    wishes: (w.data ?? []).map(x => ({ ...x, price: num(x.price) })) as Wish[],
    wishGroups: wg.data ?? [],
    claims: (c.data ?? []).map(x => ({ ...x, amount: num(x.amount) })) as Claim[],
  };
}

// Turns a Postgres / network error into something a person can act on.
function humanError(e: unknown): string {
  const msg = e instanceof Error ? e.message : typeof e === 'object' && e && 'message' in e ? String((e as { message: unknown }).message) : String(e);
  if (/claims_one_buyer/.test(msg)) return 'Quelqu’un vient de prendre ce cadeau. La page est mise à jour.';
  if (/claims_one_per_claimer/.test(msg)) return 'Tu as déjà choisi ce cadeau.';
  if (/row-level security/.test(msg)) return 'Cette action n’est pas autorisée (tu n’as peut-être plus accès à ce groupe).';
  if (/Failed to fetch|NetworkError/i.test(msg)) return 'Pas de connexion. Vérifie ton réseau et réessaie.';
  return msg || 'Une erreur est survenue.';
}

function readDraft(draft: WishDraft, allowedGroups: string[]) {
  const title = draft.title.trim();
  if (!title) throw new Error('Donne un nom au cadeau.');
  const link = draft.link.trim() ? safeUrl(draft.link) : null;
  if (draft.link.trim() && !link) throw new Error('Le lien doit commencer par http:// ou https://');
  const groups = draft.groups.filter(g => allowedGroups.includes(g));
  if (!groups.length) throw new Error('Coche au moins un groupe qui verra cette envie.');
  return { fields: { title, link, price: parseAmount(draft.price), stars: draft.stars, note: draft.note.trim() }, groups };
}

function makeActions(get: () => { me: string; d: Derived }) {
  const sb = getSupabase();
  const must = <T extends { error: unknown }>(r: T) => { if (r.error) throw r.error; return r; };

  return {
    // profile & children
    async createProfile(name: string, firstGroup: string | null) {
      const { me } = get();
      must(await sb.from('persons').insert({ user_id: me, name: name.trim() }));
      if (firstGroup) must(await sb.from('groups').insert({ name: firstGroup.trim() }));
    },
    async renamePerson(personId: string, name: string) {
      must(await sb.from('persons').update({ name: name.trim() }).eq('id', personId));
    },
    async addKid(name: string) {
      const { data } = must(await sb.from('persons').insert({ manager_id: get().me, name: name.trim() }).select('id').single());
      return (data as { id: string }).id;
    },
    async removeKid(personId: string) {
      must(await sb.from('persons').delete().eq('id', personId));
    },

    // groups
    async createGroup(name: string) {
      const { data } = must(await sb.from('groups').insert({ name: name.trim() }).select('id').single());
      return (data as { id: string }).id;
    },
    async renameGroup(groupId: string, name: string) {
      must(await sb.from('groups').update({ name: name.trim() }).eq('id', groupId));
    },
    async deleteGroup(groupId: string) {
      must(await sb.from('groups').delete().eq('id', groupId));
    },
    async regenerateInvite(groupId: string) {
      must(await sb.rpc('regenerate_invite', { g: groupId }));
    },
    async leaveGroup(groupId: string) {
      must(await sb.from('group_members').delete().eq('group_id', groupId).eq('user_id', get().me));
    },
    async addMembers(groupId: string, userIds: string[]) {
      const me = get().me;
      must(await sb.from('group_members').insert(userIds.map(u => ({ group_id: groupId, user_id: u, added_by: me }))));
    },
    async removeMember(groupId: string, userId: string) {
      must(await sb.from('group_members').delete().eq('group_id', groupId).eq('user_id', userId));
    },

    // envies
    async addWish(personId: string, draft: WishDraft) {
      const { fields, groups } = readDraft(draft, get().d.myGroupIds);
      const { data } = must(await sb.from('wishes').insert({ person_id: personId, ...fields }).select('id').single());
      const wishId = (data as { id: string }).id;
      must(await sb.from('wish_groups').insert(groups.map(g => ({ wish_id: wishId, group_id: g }))));
      return groups;
    },
    async updateWish(wishId: string, draft: WishDraft) {
      const { d } = get();
      const { fields, groups } = readDraft(draft, d.myGroupIds);
      must(await sb.from('wishes').update(fields).eq('id', wishId));
      const current = d.groupsOfWish(wishId).filter(g => d.myGroupIds.includes(g));
      const drop = current.filter(g => !groups.includes(g));
      const add = groups.filter(g => !current.includes(g));
      if (drop.length) must(await sb.from('wish_groups').delete().eq('wish_id', wishId).in('group_id', drop));
      if (add.length) must(await sb.from('wish_groups').insert(add.map(g => ({ wish_id: wishId, group_id: g }))));
    },
    async removeWish(wishId: string) {
      must(await sb.from('wishes').update({ removed: true }).eq('id', wishId));
    },

    // claims
    async claim(recipientId: string, kind: ClaimKind, opts: { wishId?: string; amount?: number | null; note?: string }) {
      must(await sb.from('claims').insert({
        recipient_id: recipientId, kind, wish_id: opts.wishId ?? null,
        amount: opts.amount ?? null, note: (opts.note ?? '').trim(),
      }));
    },
    async updateClaimAmount(claimId: string, amount: number) {
      must(await sb.from('claims').update({ amount }).eq('id', claimId));
    },
    async cancelClaim(claimId: string) {
      must(await sb.from('claims').delete().eq('id', claimId));
    },
  };
}

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
    // Other people change things too: refresh when the tab comes back, and every minute.
    const onFocus = () => { if (document.visibilityState === 'visible') reload(); };
    document.addEventListener('visibilitychange', onFocus);
    window.addEventListener('focus', onFocus);
    const timer = setInterval(onFocus, 60_000);
    return () => { document.removeEventListener('visibilitychange', onFocus); window.removeEventListener('focus', onFocus); clearInterval(timer); };
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

  if (loadError && !data) return <div className="wrap" style={{ paddingBlock: 24 }}><div className="error-banner">{loadError}</div></div>;
  if (!data || !d) return <div className="wrap" style={{ paddingBlock: 24 }}><div className="empty">Chargement des listes…</div></div>;

  return (
    <HotteContext.Provider value={{ me, data, d, busy, toast, reload, actions, run }}>
      {children}
      {toastMsg && <div className="toast" role="status">{toastMsg}</div>}
    </HotteContext.Provider>
  );
}
