'use client';

import { useState } from 'react';
import { useHotte } from '@/lib/hotte';
import { eur, parseAmount } from '@/lib/format';
import type { Claim, Person, Wish } from '@/lib/types';
import { SantaGiftToggle } from './santa/SantaGifts';
import { StopClaim } from './StopClaim';
import { WishBody } from './WishBody';

/** Someone else's envie (or my child's), with its reservations and my actions. */
export function WishCard({ person, wish, claims }: { person: Person; wish: Wish; claims: Claim[] }) {
  const { d, actions, run, toast } = useHotte();
  const [partOpen, setPartOpen] = useState(false);
  const [amount, setAmount] = useState('');

  const buy = claims.find(c => c.kind === 'buy');
  const parts = claims.filter(c => c.kind === 'part');
  const pot = parts.reduce((s, c) => s + (c.amount ?? 0), 0);
  const mine = claims.find(c => c.claimer_id === d.me);
  const othersClaimed = claims.some(c => c.claimer_id !== d.me);
  const name = person.name;
  const gone = wish.removed || !!wish.received_at;   // retiré, ou déjà reçu : plus réservable

  const submitPart = () => {
    const a = parseAmount(amount);
    if (!a) return toast('Indique un montant.');
    run(async () => {
      if (mine) await actions.updateClaimAmount(mine.id, a);
      else await actions.claim(person.id, 'part', { wishId: wish.id, amount: a });
    }, `Participation de ${eur(a)} notée`).then(r => r.ok && setPartOpen(false));
  };

  let status: React.ReactNode;
  if (buy) {
    status = buy.claimer_id === d.me
      ? <span className="chip mine">✓ Tu l’offres</span>
      : <><span className="chip bought">Déjà pris</span><span className="who">par {d.whoName(buy.claimer_id)}</span></>;
  } else if (parts.length) {
    status = (
      <>
        <span className="chip pot">Cagnotte {eur(pot)}{wish.price ? ` / ${eur(wish.price)}` : ''}</span>
        {wish.price ? <span className="bar" title={`${Math.round((pot / wish.price) * 100)} %`}><i style={{ width: `${Math.min(100, (pot / wish.price) * 100)}%` }} /></span> : null}
        <span className="who">{parts.map(c => `${c.claimer_id === d.me ? 'Toi' : d.whoName(c.claimer_id)} ${eur(c.amount)}`).join(', ')}</span>
      </>
    );
  } else status = <span className="chip free">Libre</span>;

  const partForm = (
    <form className="row" onSubmit={e => { e.preventDefault(); submitPart(); }}>
      <label className="inline-label">Je mets
        <input value={amount} inputMode="decimal" placeholder="20" className="w-90" autoFocus onChange={e => setAmount(e.target.value)} /> €
      </label>
      <button className="btn sm" type="submit">Valider</button>
      <button className="btn ghost sm" type="button" onClick={() => setPartOpen(false)}>Annuler</button>
    </form>
  );

  const warn = wish.removed ? `${name} a retiré ce cadeau.`
    : wish.received_at ? `${name} l’a déjà reçu.`
    : mine && wish.edited_at > mine.updated_at ? `Modifié par ${name} depuis ton choix : vérifie les détails.` : '';

  return (
    <li className={'item' + (buy && buy.claimer_id !== d.me ? ' taken' : '') + (gone ? ' gone' : '')}>
      <WishBody wish={wish} starsOnly />
      {warn && <span className="warn">{warn}</span>}
      {/* One line under a hairline: where it stands, 🎅, then what I can do. */}
      <div className="card-actions">
        <span className="status">{status}</span>
        {mine && <SantaGiftToggle claim={mine} />}
        <span className="row push">
          {mine ? (
            <>
              {mine.kind === 'part' && (partOpen ? partForm
                : <button className="btn ghost sm" onClick={() => { setAmount(String(mine.amount ?? '')); setPartOpen(true); }}>Changer ma part</button>)}
              <StopClaim claim={mine} title={wish.title} />
            </>
          ) : !gone && (partOpen ? partForm : (
            <>
              <button className="btn sm" disabled={!!buy || othersClaimed}
                title={othersClaimed && !buy ? 'Une cagnotte est en cours : participe plutôt' : undefined}
                onClick={() => run(() => actions.claim(person.id, 'buy', { wishId: wish.id, amount: wish.price }), `Noté : tu offres « ${wish.title} »`)}>
                Je l’offre
              </button>
              <button className="btn alt sm" disabled={!!buy} onClick={() => { setAmount(''); setPartOpen(true); }}>Je participe</button>
            </>
          ))}
        </span>
      </div>
    </li>
  );
}
