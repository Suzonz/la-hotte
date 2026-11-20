'use client';

import { useState } from 'react';
import { useHotte } from '@/lib/hotte';
import { eur, parseAmount } from '@/lib/format';
import type { Claim, Group, Person } from '@/lib/types';
import { CompleteOrContinue, SantaGiftToggle, SantaTickLabel } from './santa/SantaGifts';
import { StopClaim } from './StopClaim';
import { WishCard } from './WishCard';

/**
 * Someone's envies, to reserve, chip in or plan an off-list gift.
 * Opened from a group, it shows only the envies filed in that group
 * (the « ← group » link above already says which one).
 */
export function PersonView({ person, group }: { person: Person; group?: Group }) {
  const { d } = useHotte();
  const kid = d.isKid(person);
  const iManage = kid && d.manages(person);

  const claims = d.claimsFor(person.id);
  // Gone envies (removed, or already received) stay visible only to whoever had chosen them.
  const gone = (w: { removed: boolean; received_at: string | null }) => w.removed || !!w.received_at;
  const wishes = d.wishesOf(person.id)
    .filter(w => !gone(w) || claims.some(c => c.wish_id === w.id))
    .filter(w => (group ? d.groupsOfWish(w.id).includes(group.id) : true))
    .sort((a, b) => Number(gone(a)) - Number(gone(b)) || b.stars - a.stars);
  const offs = claims.filter(c => c.kind === 'other');

  return (
    <>
      <div>
        {kid && <span className="eyebrow">Envies gérées par {d.parentNames(person)}</span>}
        <h1>{person.name}{!kid && <> <span className="h1-note">(ne voit pas ce qui est réservé)</span></>}</h1>
        {iManage && <p className="sub">Tu gères ses envies. Tout le monde voit ce qui est réservé dessus, toi compris, pour éviter les doublons.</p>}
        {d.myDraws.filter(x => x.pair.receiver_id === person.id && !d.isRevealed(x.santa)).map(({ pair, santa }) => {
          const giver = d.personById.get(pair.giver_id);
          return (
            <p key={santa.id} className="santa-line">
              🎅 {giver?.user_id === d.me ? 'Tu es son Secret Santa' : `${giver?.name} est son Secret Santa`}
              <span className="who"> · {santa.name}{santa.budget != null ? ` · ${eur(santa.budget)}` : ''}</span>
            </p>
          );
        })}
      </div>

      <section className="panel">
        {wishes.length === 0 && offs.length === 0
          ? <p className="note">{person.name} n’a encore rien rangé {group ? `dans le groupe « ${group.name} »` : 'dans vos groupes communs'}. Tu peux quand même prévoir un cadeau hors liste.</p>
          : (
            <ul className="items">
              {wishes.map(w => <WishCard key={w.id} person={person} wish={w} claims={d.claimsOn(w.id)} />)}
              {offs.map(c => <OffListCard key={c.id} claim={c} />)}
            </ul>
          )}
      </section>

      <OffListForm person={person} />
    </>
  );
}

/** A gift that is not in the envies, shown with them so nobody has the same idea. */
function OffListCard({ claim: c }: { claim: Claim }) {
  const { d } = useHotte();
  const mine = c.claimer_id === d.me;
  return (
    <li className="item">
      <div className="ihead">
        <h3 className="ititle">{c.note || 'Une surprise'}</h3>
        {c.amount ? <span className="price">{eur(c.amount)}</span> : null}
      </div>
      {/* Same words as an envie: « ✓ Tu l'offres » or « Déjà pris par Bob », then « hors liste ». */}
      <div className="card-actions">
        <span className="status">
          {mine
            ? <span className="chip mine">✓ Tu l’offres</span>
            : <><span className="chip bought">Déjà pris</span><span className="who">par {d.whoName(c.claimer_id)} · hors liste</span></>}
          {mine && <span className="who">hors liste</span>}
        </span>
        <SantaGiftToggle claim={c} />
        {mine && <span className="row push"><StopClaim claim={c} title={c.note || 'Une surprise'} /></span>}
      </div>
    </li>
  );
}

/** « + J'offre autre chose » : the explanation only shows once it is opened. */
function OffListForm({ person }: { person: Person }) {
  const { d, actions, run, toast } = useHotte();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState('');
  const [amount, setAmount] = useState('');
  // Secret Santas where I (or my child) drew this person: the gift can be ticked 🎅 right away.
  const draws = d.myDraws.filter(x => x.pair.receiver_id === person.id && !d.isRevealed(x.santa));
  const [forSanta, setForSanta] = useState<string[]>([]);   // santa ids, none ticked at first
  const [asking, setAsking] = useState<null | { santaId: string; giverId: string }>(null);

  const save = () => {
    if (!note.trim()) return toast('Décris ton idée en quelques mots.');
    const chosen = draws.filter(x => forSanta.includes(x.santa.id));
    run(async () => {
      const claimId = await actions.claim(person.id, 'other', { note: note.slice(0, 200), amount: parseAmount(amount) });
      for (const x of chosen) await actions.tagSantaGift(claimId, x.santa.id, x.pair.giver_id);
    }, chosen.length ? undefined : 'Noté')
      .then(r => {
        if (!r.ok) return;
        setOpen(false); setNote(''); setAmount(''); setForSanta([]);
        if (chosen.length) setAsking({ santaId: chosen[0].santa.id, giverId: chosen[0].pair.giver_id });
      });
  };

  return (
    <>
      {open ? (
        <section className="panel">
          <h2>J’offre autre chose</h2>
          <p className="note">Pour une surprise qui n’est pas dans ses envies. Les autres la verront, pour ne pas avoir la même idée.</p>
          <form className="grid" onSubmit={e => { e.preventDefault(); save(); }}>
            <label className="full">Ton idée
              <input value={note} maxLength={200} placeholder="Ex. un pull tricoté main" autoFocus onChange={e => setNote(e.target.value)} />
            </label>
            <label>Budget (facultatif, €)
              <input value={amount} inputMode="decimal" onChange={e => setAmount(e.target.value)} />
            </label>
            {draws.length > 0 && (
              <div className="stack" style={{ justifyContent: 'flex-end', gap: 4 }}>
                {draws.map(({ pair, santa }) => {
                  const on = forSanta.includes(santa.id);
                  return (
                    <label key={santa.id} className="santa-tick">
                      <input type="checkbox" checked={on} onChange={e => setForSanta(e.target.checked ? [...forSanta, santa.id] : forSanta.filter(x => x !== santa.id))} />
                      <SantaTickLabel giverId={pair.giver_id} santaName={santa.name} several={draws.length > 1} />
                    </label>
                  );
                })}
              </div>
            )}
            <div className="row full">
              <button className="btn" type="submit">Enregistrer</button>
              <button className="btn ghost" type="button" onClick={() => setOpen(false)}>Annuler</button>
            </div>
          </form>
        </section>
      ) : <div><button className="btn alt sm" onClick={() => setOpen(true)}>＋ J’offre autre chose</button></div>}
      {asking && <CompleteOrContinue santaId={asking.santaId} giverId={asking.giverId} receiver={person.name} onClose={() => setAsking(null)} />}
    </>
  );
}
