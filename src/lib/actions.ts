import { getSupabase } from './supabase/client';
import { parseAmount, safeUrl } from './format';
import type { Derived } from './derive';
import type { ClaimKind, SantaMode, WishDraft } from './types';

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

export function makeActions(get: () => { me: string; d: Derived }) {
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
    // co-parents
    async addCoParent(kidId: string, userId: string) {
      must(await sb.from('person_managers').insert({ person_id: kidId, user_id: userId, added_by: get().me }));
    },
    async removeParent(kidId: string, userId: string) {
      must(await sb.rpc('kid_remove_manager', { kid: kidId, u: userId }));
    },

    // after Christmas
    async setReceived(wishId: string, received: boolean) {
      must(await sb.from('wishes').update({ received_at: received ? new Date().toISOString() : null }).eq('id', wishId));
    },
    async setOffered(claimId: string, offered: boolean) {
      must(await sb.from('claims').update({ offered_at: offered ? new Date().toISOString() : null }).eq('id', claimId));
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
