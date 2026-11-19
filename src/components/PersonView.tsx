'use client';

import { useState } from 'react';
import { useHotte } from '@/lib/hotte';
import { eur, parseAmount } from '@/lib/format';
import type { Group, Person } from '@/lib/types';
import { CompleteOrContinue, SantaGiftToggle } from './SantaGifts';
import { WishCard } from './WishCard';

/**
 * Someone's envies, to reserve, chip in or plan an off-list gift.
 * Opened from a group, it shows only the envies filed in that group.
 * (My own children are managed in « Ma liste ».)
 */
export function PersonView({ person, group }: { person: Person; group?: Group }) {
  const { d } = useHotte();
  const iManage = person.manager_id === d.me;

  const claims = d.claimsFor(person.id);
  const wishes = d.wishesOf(person.id)
    .filter(w => !w.removed || claims.some(c => c.wish_id === w.id))
    .filter(w => (group ? d.groupsOfWish(w.id).includes(group.id) : true))
    .sort((a, b) => Number(a.removed) - Number(b.removed) || b.stars - a.stars);
  const common = d.commonGroups(person).map(g => g.name);
  const manager = person.manager_id ? d.personByUser.get(person.manager_id) : null;
  const managedBy = person.manager_id ? `gérées par ${iManage ? 'toi' : manager?.name ?? 'un parent'}` : '';

  return (
    <>
      <div>
        <span className="eyebrow">
          {group ? `Groupe ${group.name}${managedBy ? ' · ' + managedBy : ''}` : person.manager_id ? `Envies ${managedBy}` : 'Les envies de'}
        </span>
        <h1>{person.name}</h1>
        <p className="sub">
          {iManage
            ? 'Tu gères ses envies. Tout le monde voit ce qui est réservé dessus, toi compris, pour éviter les doublons.'
            : person.manager_id ? '' : `${person.name} ne voit pas ce qui est réservé sur ses envies.`}
          {group && common.length > 1 && ` Vous êtes aussi ensemble dans : ${common.filter(n => n !== group.name).join(', ')}.`}
          {!group && !iManage && ` Groupes en commun : ${common.join(', ') || 'aucun'}.`}
        </p>
      </div>

      {d.myDraws.filter(x => x.pair.receiver_id === person.id && !d.isRevealed(x.santa)).map(({ pair, santa }) => {
        const giver = d.personById.get(pair.giver_id);
        return (
          <p key={santa.id} className="note">
            🎅 {giver?.user_id === d.me ? <b>C’est toi son Secret Santa</b> : <><b>{giver?.name}</b> est son Secret Santa</>}
            {' '}· {santa.name}{santa.budget != null ? ` · ${eur(santa.budget)}` : ''}
          </p>
        );
      })}

      {wishes.length === 0
        ? <div className="empty">{person.name} n’a encore rien rangé {group ? `dans le groupe « ${group.name} »` : 'dans vos groupes communs'}. Tu peux quand même prévoir un cadeau hors liste plus bas.</div>
        : <ul className="items">{wishes.map(w => <WishCard key={w.id} person={person} wish={w} claims={d.claimsOn(w.id)} />)}</ul>}

      <OffList person={person} />
    </>
  );
}

function OffList({ person }: { person: Person }) {
  const { d, actions, run, toast } = useHotte();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState('');
  const [amount, setAmount] = useState('');
  const offs = d.claimsFor(person.id).filter(c => c.kind === 'other');
  // Secret Santas where I (or my child) drew this person: the gift can be ticked 🎅 right away.
  const draws = d.myDraws.filter(x => x.pair.receiver_id === person.id && !d.isRevealed(x.santa));
  const [forSanta, setForSanta] = useState<string[]>([]);   // santa ids
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
    <section className="panel">
      <h2>Cadeaux hors liste pour {person.name}</h2>
      <p className="note">Pour une surprise qui n’est pas dans ses envies. Indique-la ici pour que deux personnes n’aient pas la même idée.</p>
      {offs.length > 0 && (
        <div>
          {offs.map(c => (
            <div key={c.id} className="stack" style={{ alignItems: 'stretch', gap: 4 }}>
              <div className="gline">
                <span className="t"><b>{c.claimer_id === d.me ? 'Toi' : d.whoName(c.claimer_id)}</b> : {c.note || 'une surprise'}</span>
                <span className="row">
                  {c.amount ? <span className="a">{eur(c.amount)}</span> : null}
                  {c.claimer_id === d.me && <button className="btn ghost sm" onClick={() => run(() => actions.cancelClaim(c.id), 'Annulé')}>Annuler</button>}
                </span>
              </div>
              <SantaGiftToggle claim={c} />
            </div>
          ))}
        </div>
      )}
      {open ? (
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
                const giver = d.personById.get(pair.giver_id);
                const on = forSanta.includes(santa.id);
                return (
                  <label key={santa.id} className="santa-tick">
                    <input type="checkbox" checked={on} onChange={e => setForSanta(e.target.checked ? [...forSanta, santa.id] : forSanta.filter(x => x !== santa.id))} />
                    🎅 Pour mon Secret Santa{giver && giver.user_id !== d.me ? ` de ${giver.name}` : ''} <span className="who">({santa.name})</span>
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
      ) : <div className="row"><button className="btn alt sm" onClick={() => setOpen(true)}>J’offre autre chose</button></div>}
      {asking && <CompleteOrContinue santaId={asking.santaId} giverId={asking.giverId} receiver={person.name} onClose={() => setAsking(null)} />}
    </section>
  );
}
