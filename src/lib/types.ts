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

/** draw: the app draws at random · manual: drawn elsewhere, names are typed in */
export type SantaMode = 'draw' | 'manual';
export type Santa = {
  /** null until the organiser has chosen */
  id: string; group_id: string; name: string; mode: SantaMode | null; budget: number | null;
  event_date: string; reveal_at: string; created_by: string;
};
export type SantaParticipant = { santa_id: string; person_id: string };
export type SantaExclusion = { santa_id: string; a: string; b: string };
/** Only the pairs the database lets me see: mine, my children's, those I typed in, or all after the reveal. */
export type SantaPair = {
  santa_id: string; giver_id: string; receiver_id: string; entered_by: string | null;
  /** set when the server changed this draw (someone left): the giver gets a notice */
  changed_at: string | null;
};
export type SantaProgress = { participants: number; drawn: number };

/** Private to the giver: « this reservation is (part of) my Secret Santa gift ». */
export type SantaGift = { claim_id: string; santa_id: string; giver_id: string };
/** Private to the giver: set by hand, « complet » or « en cours ». */
export type SantaStatus = { santa_id: string; giver_id: string; done: boolean };

export type HotteData = {
  persons: Person[]; groups: Group[]; members: Member[];
  wishes: Wish[]; wishGroups: WishGroup[]; claims: Claim[];
  santas: Santa[]; santaParticipants: SantaParticipant[]; santaExclusions: SantaExclusion[];
  santaPairs: SantaPair[]; santaProgress: Record<string, SantaProgress>;
  /** organiser only, « tirage déjà fait »: participants who have not said whom they drew */
  santaMissing: Record<string, string[]>;
  santaGifts: SantaGift[]; santaStatus: SantaStatus[];
};

/** Fields of the envie form. `privateOnly`: the owner explicitly chose « Seulement moi ». */
export type WishDraft = { title: string; link: string; price: string; stars: number; note: string; groups: string[]; privateOnly: boolean };
export const emptyDraft = (): WishDraft => ({ title: '', link: '', price: '', stars: 2, note: '', groups: [], privateOnly: false });
