import { byName } from './format';
import type { Claim, Group, HotteData, Person } from './types';

// Everything here only reads what the database lets this user see (RLS):
// filtering below is about presentation, never about secrecy.

export function derive(data: HotteData, me: string) {
  const personById = new Map(data.persons.map(p => [p.id, p]));
  const personByUser = new Map(data.persons.filter(p => p.user_id).map(p => [p.user_id as string, p]));
  const groupById = new Map(data.groups.map(g => [g.id, g]));
  const myPerson = personByUser.get(me) ?? null;

  const membersOf = (gid: string) => data.members.filter(m => m.group_id === gid);
  const isMember = (uid: string, gid: string) => data.members.some(m => m.group_id === gid && m.user_id === uid);
  const myGroups: Group[] = data.groups.filter(g => isMember(me, g.id)).sort((a, b) => byName(a.name, b.name));
  const myGroupIds = myGroups.map(g => g.id);

  /** Every account behind a person: themself, or all the parents of a child (first one first). */
  const accountsOf = (p: Person): string[] => p.user_id
    ? [p.user_id]
    : [p.manager_id ?? '', ...data.personManagers.filter(m => m.person_id === p.id).map(m => m.user_id)].filter(Boolean);
  const accountOf = (p: Person) => accountsOf(p)[0] ?? '';
  const manages = (p: Person) => accountsOf(p).includes(me);
  const isKid = (p: Person) => !p.user_id;
  const myKids = data.persons.filter(p => isKid(p) && manages(p)).sort((a, b) => byName(a.name, b.name));
  /** « toi, Paul » — the parents of a child, as this viewer names them. */
  const parentNames = (p: Person) => accountsOf(p).map(u => (u === me ? 'toi' : personByUser.get(u)?.name ?? 'un parent')).join(', ');

  const groupsOfWish = (wishId: string) => data.wishGroups.filter(wg => wg.wish_id === wishId && groupById.has(wg.group_id)).map(wg => wg.group_id);
  const wishesOf = (personId: string) => data.wishes.filter(w => w.person_id === personId);
  const claimsOn = (wishId: string) => data.claims.filter(c => c.wish_id === wishId);
  const claimsFor = (personId: string) => data.claims.filter(c => c.recipient_id === personId);
  const myClaims = data.claims.filter(c => c.claimer_id === me);
  const commonGroups = (p: Person) => myGroups.filter(g => accountsOf(p).some(a => isMember(a, g.id)));

  /** A name for whoever made a claim; people outside my groups stay anonymous. */
  const whoName = (uid: string) => (uid === me ? 'toi' : personByUser.get(uid)?.name ?? 'quelqu’un d’un autre groupe');

  // People shown in the top bar: accounts I share a group with, my children,
  // and other people's children who have at least one envie I can see.
  const others = data.persons
    .filter(p => p.user_id !== me)
    .filter(p => p.user_id || manages(p) || wishesOf(p.id).some(w => !w.removed) || myClaims.some(c => c.recipient_id === p.id))
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
    membersOf, isMember, accountOf, accountsOf, manages, isKid, parentNames, commonGroups,
    groupsOfWish, wishesOf, claimsOn, claimsFor, whoName,
    santasOf, participantsOf, exclusionsOf, pairsOf, isRevealed, santaProgressOf, missingOf, myDraws,
    santaGiftClaims, isSantaGift, santaGiftState,
  };
}
export type Derived = ReturnType<typeof derive>;
