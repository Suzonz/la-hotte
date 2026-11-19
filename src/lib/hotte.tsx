'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { getSupabase } from './supabase/client';
import { byName, parseAmount, safeUrl } from './format';
import type { Claim, ClaimKind, Group, HotteData, Person, Santa, SantaMode, SantaProgress, Wish, WishDraft } from './types';

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

  // Secret Santa
  const santasOf = (gid: string) => data.santas.filter(s => s.group_id === gid).sort((a, b) => a.event_date.localeCompare(b.event_date));
  const participantsOf = (sid: string) => data.santaParticipants.filter(p => p.santa_id === sid).map(p => p.person_id);
  const exclusionsOf = (sid: string) => data.santaExclusions.filter(e => e.santa_id === sid);
  const pairsOf = (sid: string) => data.santaPairs.filter(p => p.santa_id === sid);
  const isRevealed = (s: { reveal_at: string }) => new Date(s.reveal_at).getTime() <= Date.now();
  const santaProgressOf = (sid: string) => data.santaProgress[sid] ?? { participants: participantsOf(sid).length, drawn: 0 };
  const missingOf = (sid: string) => data.santaMissing[sid] ?? [];
  /** My reservations ticked 🎅 for this Secret Santa (as this giver). */
  const santaGiftClaims = (sid: string, giverId: string) =>
    data.santaGifts.filter(x => x.santa_id === sid && x.giver_id === giverId)
      .map(x => data.claims.find(c => c.id === x.claim_id)).filter((c): c is Claim => !!c);
  const isSantaGift = (claimId: string, sid: string) => data.santaGifts.some(x => x.claim_id === claimId && x.santa_id === sid);
  /** ⏳ nothing yet · 🛍️ in progress · ✅ done (set by hand) */
  const santaGiftState = (sid: string, giverId: string): 'none' | 'progress' | 'done' => {
    if (data.santaStatus.some(x => x.santa_id === sid && x.giver_id === giverId && x.done)) return 'done';
    return santaGiftClaims(sid, giverId).length ? 'progress' : 'none';
  };
  /** Draws I am the giver of (myself, or one of my children), not yet revealed or not. */
  const myDraws = data.santaPairs
    .filter(p => { const g = personById.get(p.giver_id); return g ? manages(g) : false; })
    .map(p => ({ pair: p, santa: data.santas.find(s => s.id === p.santa_id) }))
    .filter((x): x is { pair: typeof x.pair; santa: NonNullable<typeof x.santa> } => !!x.santa);

  return {
    me, myPerson, myGroups, myGroupIds, myKids, myClaims, others,
    personById, personByUser, groupById,
    membersOf, isMember, accountOf, manages, commonGroups,
    groupsOfWish, wishesOf, claimsOn, claimsFor, whoName,
    santasOf, participantsOf, exclusionsOf, pairsOf, isRevealed, santaProgressOf, missingOf, myDraws,
    santaGiftClaims, isSantaGift, santaGiftState,
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
  const [p, g, m, w, wg, c, s, sp, se, pr, sg, ss] = await Promise.all([
    sb.from('persons').select('id, user_id, manager_id, name'),
    sb.from('groups').select('id, name, created_by, invite_code'),
    sb.from('group_members').select('group_id, user_id, added_by'),
    sb.from('wishes').select('*'),
    sb.from('wish_groups').select('wish_id, group_id'),
    sb.from('claims').select('*'),
    sb.from('santas').select('id, group_id, name, mode, budget, event_date, reveal_at, created_by'),
    sb.from('santa_participants').select('santa_id, person_id'),
    sb.from('santa_exclusions').select('santa_id, a, b'),
    sb.from('santa_pairs').select('santa_id, giver_id, receiver_id, entered_by, changed_at'),
    sb.from('santa_gifts').select('claim_id, santa_id, giver_id'),
    sb.from('santa_status').select('santa_id, giver_id, done'),
  ]);
  const err = [p, g, m, w, wg, c, s, sp, se, pr, sg, ss].find(r => r.error)?.error;
  if (err) throw new Error(err.message);

  const santas = ((s.data ?? []) as Santa[]).map(x => ({ ...x, budget: num(x.budget) }));
  // Progress counts only (who has whom stays secret).
  const progress = await Promise.all(santas.map(x => sb.rpc('santa_progress', { s: x.id })));
  const santaProgress: Record<string, SantaProgress> = {};
  santas.forEach((x, i) => {
    const row = (progress[i].data as SantaProgress[] | null)?.[0];
    if (row) santaProgress[x.id] = row;
  });
  // Who has not said whom they drew yet (the server only answers the organiser).
  const manual = santas.filter(x => x.mode === 'manual');
  const missing = await Promise.all(manual.map(x => sb.rpc('santa_missing', { s: x.id })));
  const santaMissing: Record<string, string[]> = {};
  manual.forEach((x, i) => { santaMissing[x.id] = (missing[i].data as string[] | null) ?? []; });

  return {
    persons: p.data ?? [], groups: g.data ?? [], members: m.data ?? [],
    wishes: (w.data ?? []).map(x => ({ ...x, price: num(x.price) })) as Wish[],
    wishGroups: wg.data ?? [],
    claims: (c.data ?? []).map(x => ({ ...x, amount: num(x.amount) })) as Claim[],
    santas, santaParticipants: sp.data ?? [], santaExclusions: se.data ?? [], santaPairs: pr.data ?? [], santaProgress, santaMissing,
    santaGifts: sg.data ?? [], santaStatus: ss.data ?? [],
  };
}

// Turns a Postgres / network error into something a person can act on.
function humanError(e: unknown): string {
  const msg = e instanceof Error ? e.message : typeof e === 'object' && e && 'message' in e ? String((e as { message: unknown }).message) : String(e);
  if (/claims_one_buyer/.test(msg)) return 'Quelqu’un vient de prendre ce cadeau. La page est mise à jour.';
  if (/claims_one_per_claimer/.test(msg)) return 'Tu as déjà choisi ce cadeau.';
  if (/santa_pairs_santa_id_receiver_id_key/.test(msg)) return 'Quelqu’un a déjà indiqué avoir tiré cette personne. Vérifie le papier tiré, ou demande à l’organisateur de recommencer le tirage.';
  if (/santa_pairs_pkey/.test(msg)) return 'Un tirage est déjà enregistré pour cette personne.';
  if (/santa_pairs/.test(msg) && /row-level security/.test(msg)) return 'Tu ne peux indiquer que la personne que toi (ou ton enfant) as tirée, et seulement pour un tirage déjà fait.';
  if (/santa_participants/.test(msg) && /row-level security/.test(msg)) return 'Le tirage est déjà fait : utilise « Retirer » ou « Refaire le tirage » pour changer les participants.';
  if (/row-level security/.test(msg)) return 'Cette action n’est pas autorisée (tu n’as peut-être plus accès à ce groupe).';
  if (/Failed to fetch|NetworkError/i.test(msg)) return 'Pas de connexion. Vérifie ton réseau et réessaie.';
  return msg || 'Une erreur est survenue.';
}

function readDraft(draft: WishDraft, allowedGroups: string[]) {
  const title = draft.title.trim();
  if (!title) throw new Error('Donne un nom au cadeau.');
  const link = draft.link.trim() ? safeUrl(draft.link) : null;
  if (draft.link.trim() && !link) throw new Error('Le lien doit commencer par http:// ou https://');
  // Nothing is ticked by default: the owner picks groups, or explicitly « Seulement moi ».
  const groups = draft.privateOnly ? [] : draft.groups.filter(g => allowedGroups.includes(g));
  if (!draft.privateOnly && !groups.length) throw new Error('Choisis qui verra cette envie : un groupe, ou « Seulement moi ».');
  return { fields: { title, link, price: parseAmount(draft.price), stars: draft.stars, note: draft.note.trim() }, groups };
}

export type SantaForm = { name: string; mode: SantaMode; budget: string; eventDate: string; revealDate: string; participants: string[] };

function santaFields(v: SantaForm) {
  const name = v.name.trim();
  if (!name) throw new Error('Donne un nom au Secret Santa.');
  if (!v.eventDate || !v.revealDate) throw new Error('Indique la date de l’échange et celle de la révélation.');
  if (v.revealDate < v.eventDate) throw new Error('La révélation doit avoir lieu le jour de l’échange ou après.');
  // Reveal at midnight, local time, on the chosen day.
  return { name, mode: v.mode, budget: parseAmount(v.budget), event_date: v.eventDate, reveal_at: new Date(v.revealDate + 'T00:00:00').toISOString() };
}

function makeActions(get: () => { me: string; d: Derived }) {
  const sb = getSupabase();
  const must = <T extends { error: unknown }>(r: T) => { if (r.error) throw r.error; return r; };

  /**
   * A Secret Santa marked « complet » that no longer has any gift ticked goes back
   * to « rien de choisi » (otherwise cancelling the only gift would leave it complete).
   * `before` is the state prior to removing `claimId` (from one Secret Santa, or all).
   */
  async function reopenEmptySantas(before: Derived, claimId: string, onlySanta?: string) {
    for (const { pair, santa } of before.myDraws) {
      if (onlySanta && santa.id !== onlySanta) continue;
      const gifts = before.santaGiftClaims(santa.id, pair.giver_id);
      if (!gifts.some(c => c.id === claimId)) continue;
      if (gifts.length === 1 && before.santaGiftState(santa.id, pair.giver_id) === 'done') {
        must(await sb.from('santa_status').upsert({ santa_id: santa.id, giver_id: pair.giver_id, done: false, updated_at: new Date().toISOString() }));
      }
    }
  }

  return {
    // profile & children
    async createProfile(name: string, firstGroup: string | null) {
      const { me } = get();
      must(await sb.from('persons').insert({ user_id: me, name: name.trim() }));
      if (firstGroup) must(await sb.from('groups').insert({ name: firstGroup.trim() }));
    },
    /** Deletes my account and everything that is mine; groups and Secret Santas go to another member. */
    async deleteMyAccount() {
      must(await sb.rpc('delete_my_account'));
      await sb.auth.signOut();
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
      if (groups.length) must(await sb.from('wish_groups').insert(groups.map(g => ({ wish_id: wishId, group_id: g }))));
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
      const { data } = must(await sb.from('claims').insert({
        recipient_id: recipientId, kind, wish_id: opts.wishId ?? null,
        amount: opts.amount ?? null, note: (opts.note ?? '').trim(),
      }).select('id').single());
      return (data as { id: string }).id;
    },
    async updateClaimAmount(claimId: string, amount: number) {
      must(await sb.from('claims').update({ amount }).eq('id', claimId));
    },
    async cancelClaim(claimId: string) {
      const before = get().d;
      must(await sb.from('claims').delete().eq('id', claimId));   // its 🎅 ticks go with it (cascade)
      await reopenEmptySantas(before, claimId);
    },

    // Secret Santa
    /** Creates it; for « tirage à faire », also stores the exclusions and draws straight away. */
    async createSanta(groupId: string, v: SantaForm, exclusions: [string, string][] = []) {
      const { data } = must(await sb.from('santas').insert({ group_id: groupId, ...santaFields(v) }).select('id').single());
      const id = (data as { id: string }).id;
      if (v.participants.length) must(await sb.from('santa_participants').insert(v.participants.map(p => ({ santa_id: id, person_id: p }))));
      const ex = exclusions.filter(([a, b]) => v.participants.includes(a) && v.participants.includes(b));
      if (ex.length) must(await sb.from('santa_exclusions').insert(ex.map(([a, b]) => ({ santa_id: id, a, b }))));
      // The Secret Santa exists either way: a failed draw is reported, not thrown,
      // so the form closes and nobody creates it twice. The organiser can retry from the card.
      let drawError: string | null = null;
      if (v.mode === 'draw') {
        const r = await sb.rpc('santa_draw', { s: id });
        if (r.error) drawError = r.error.message;
      }
      return { id, drawError };
    },
    async updateSanta(santaId: string, v: SantaForm) {
      must(await sb.from('santas').update(santaFields(v)).eq('id', santaId));
      const current = get().d.participantsOf(santaId);
      const drop = current.filter(p => !v.participants.includes(p));
      const add = v.participants.filter(p => !current.includes(p));
      if (drop.length) must(await sb.from('santa_participants').delete().eq('santa_id', santaId).in('person_id', drop));
      if (add.length) must(await sb.from('santa_participants').insert(add.map(p => ({ santa_id: santaId, person_id: p }))));
    },
    /** After the draw: the server takes them out and rewires the chain; returns how many draws changed. */
    async removeParticipant(santaId: string, personId: string) {
      const { data } = must(await sb.rpc('santa_remove_participant', { s: santaId, p: personId }));
      return data as number;
    },
    /** Adding people after the draw: erase it, add them, and draw again (if La Hotte draws). */
    async redrawWith(santaId: string, personIds: string[], mode: SantaMode) {
      must(await sb.rpc('santa_reset', { s: santaId }));
      must(await sb.from('santa_participants').insert(personIds.map(p => ({ santa_id: santaId, person_id: p }))));
      if (mode === 'draw') must(await sb.rpc('santa_draw', { s: santaId }));
    },
    async tagSantaGift(claimId: string, santaId: string, giverId: string) {
      must(await sb.from('santa_gifts').insert({ claim_id: claimId, santa_id: santaId, giver_id: giverId }));
    },
    async untagSantaGift(claimId: string, santaId: string) {
      const before = get().d;
      must(await sb.from('santa_gifts').delete().eq('claim_id', claimId).eq('santa_id', santaId));
      await reopenEmptySantas(before, claimId, santaId);
    },
    async setSantaDone(santaId: string, giverId: string, done: boolean) {
      must(await sb.from('santa_status').upsert({ santa_id: santaId, giver_id: giverId, done, updated_at: new Date().toISOString() }));
    },
    async deleteSanta(santaId: string) {
      must(await sb.from('santas').delete().eq('id', santaId));
    },
    async addExclusion(santaId: string, a: string, b: string) {
      must(await sb.from('santa_exclusions').insert({ santa_id: santaId, a, b }));
    },
    async removeExclusion(santaId: string, a: string, b: string) {
      must(await sb.from('santa_exclusions').delete().eq('santa_id', santaId).eq('a', a).eq('b', b));
    },
    async drawSanta(santaId: string) {
      const { data } = must(await sb.rpc('santa_draw', { s: santaId }));
      return data as number;
    },
    async resetSanta(santaId: string) {
      must(await sb.rpc('santa_reset', { s: santaId }));
    },
    /** Types in a draw made elsewhere (paper, another site), replacing the one I typed before. */
    async enterPair(santaId: string, giverId: string, receiverId: string) {
      must(await sb.from('santa_pairs').delete().eq('santa_id', santaId).eq('giver_id', giverId));
      must(await sb.from('santa_pairs').insert({ santa_id: santaId, giver_id: giverId, receiver_id: receiverId, entered_by: get().me }));
    },
    async clearPair(santaId: string, giverId: string) {
      must(await sb.from('santa_pairs').delete().eq('santa_id', santaId).eq('giver_id', giverId));
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

  if (loadError && !data) return <div className="wrap" style={{ paddingBlock: 24 }}><div className="error-banner">{loadError}</div></div>;
  if (!data || !d) return <div className="wrap" style={{ paddingBlock: 24 }}><div className="empty">Chargement des listes…</div></div>;

  return (
    <HotteContext.Provider value={{ me, data, d, busy, toast, reload, actions, run }}>
      {children}
      {toastMsg && <div className="toast" role="status">{toastMsg}</div>}
    </HotteContext.Provider>
  );
}
