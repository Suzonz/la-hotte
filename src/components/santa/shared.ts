import { useHotte } from '@/lib/hotte';
import { byName } from '@/lib/format';
import type { Group, SantaMode } from '@/lib/types';

// Shared bits of the Secret Santa screens.
// Design rule for this box: one thing stands out per card — what *I* have to do
// or know. Everything else is plain grey text; organiser actions live under ⚙️.

const dayFmt = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long' });
export const frDay = (isoOrDate: string) => dayFmt.format(new Date(isoOrDate.length === 10 ? isoOrDate + 'T00:00:00' : isoOrDate));
export const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export const MODES: Record<SantaMode, { icon: string; title: string; text: string }> = {
  draw: { icon: '🎲', title: 'Faire le tirage avec La Hotte', text: 'La Hotte tire au sort. Personne, pas même toi, ne sait qui a qui avant la révélation.' },
  manual: { icon: '✍️', title: 'Le tirage est déjà fait', text: 'Vous avez tiré au sort ailleurs (papiers, autre site). Chacun indique ici la personne qu’il a tirée.' },
};

export const GIFT_STATE = {
  none: '⏳ Pas encore de cadeau choisi',
  progress: '🛍️ Cadeau en cours',
  done: '✅ Cadeau complet',
} as const;

export function defaultDates() {
  const now = new Date();
  let year = now.getFullYear();
  if (now > new Date(year, 11, 25)) year += 1;
  return { eventDate: `${year}-12-25`, revealDate: `${year}-12-26`, year };
}

/** Everyone who can take part: the group's members and their children. */
export function useCandidates(group: Group) {
  const { d, data } = useHotte();
  const memberIds = d.membersOf(group.id).map(m => m.user_id);
  return data.persons
    .filter(p => (p.user_id && memberIds.includes(p.user_id)) || (p.manager_id && memberIds.includes(p.manager_id)))
    .sort((a, b) => byName(a.name, b.name));
}
