import { getSupabase } from './supabase/client';
import type { Claim, HotteData, Santa, SantaProgress, Wish } from './types';

const num = (v: unknown) => (v == null ? null : Number(v));

/** Everything this user may see, in one go (RLS decides what comes back). */
export async function fetchAll(): Promise<HotteData> {
  const sb = getSupabase();
  const [p, g, m, w, wg, c, s, sp, se, pr, sg, ss, pm] = await Promise.all([
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
    sb.from('person_managers').select('person_id, user_id'),
  ]);
  const err = [p, g, m, w, wg, c, s, sp, se, pr, sg, ss, pm].find(r => r.error)?.error;
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
    santaGifts: sg.data ?? [], santaStatus: ss.data ?? [], personManagers: pm.data ?? [],
  };
}

// Turns a Postgres / network error into something a person can act on.
export function humanError(e: unknown): string {
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
