export type Person = { id: string; user_id: string | null; manager_id: string | null; name: string };
export type Group = { id: string; name: string; created_by: string; invite_code: string };
export type Member = { group_id: string; user_id: string; added_by: string | null };
export type Wish = {
  id: string; person_id: string; title: string; link: string | null; price: number | null;
  stars: number; note: string; removed: boolean; created_at: string; edited_at: string;
};
export type WishGroup = { wish_id: string; group_id: string };
export type ClaimKind = 'buy' | 'part' | 'other';
export type Claim = {
  id: string; claimer_id: string; recipient_id: string; wish_id: string | null; kind: ClaimKind;
  amount: number | null; note: string; created_at: string; updated_at: string;
};

export type HotteData = {
  persons: Person[]; groups: Group[]; members: Member[];
  wishes: Wish[]; wishGroups: WishGroup[]; claims: Claim[];
};

/** Fields of the envie form. */
export type WishDraft = { title: string; link: string; price: string; stars: number; note: string; groups: string[] };
export const emptyDraft = (): WishDraft => ({ title: '', link: '', price: '', stars: 2, note: '', groups: [] });
