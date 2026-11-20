'use client';

import { useState } from 'react';
import { useHotte } from '@/lib/hotte';
import { eur } from '@/lib/format';
import type { Claim } from '@/lib/types';
import { Modal } from '../Modal';
import { frDay } from './shared';


/** « 🎅 Secret Santa » (« de Léo » when it is my child who gives; the Secret Santa's name if I am in several). */
export function SantaTickLabel({ giverId, santaName, several }: { giverId: string; santaName: string; several: boolean }) {
  const { d } = useHotte();
  const giver = d.personById.get(giverId);
  return <>🎅 Secret Santa{giver && giver.user_id !== d.me ? ` de ${giver.name}` : ''}{several && <span className="who"> · {santaName}</span>}</>;
}

/**
 * Under one of MY reservations: « 🎅 Secret Santa » (unticked at first) for each Secret Santa
 * in which I (or my child) give to this very person. Private to me.
 */
export function SantaGiftToggle({ claim }: { claim: Claim }) {
  const { d, actions, run } = useHotte();
  const [asking, setAsking] = useState<null | { santaId: string; giverId: string; receiver: string }>(null);
  // The box follows the click at once; the saved value takes over when the server has answered.
  const [pending, setPending] = useState<Record<string, boolean>>({});
  const draws = d.myDraws.filter(x => x.pair.receiver_id === claim.recipient_id && !d.isRevealed(x.santa));
  if (claim.claimer_id !== d.me || !draws.length) return null;

  const settle = (santaId: string) => setPending(p => { const { [santaId]: _, ...rest } = p; return rest; });

  return (
    <>
      {draws.map(({ pair, santa }) => {
        const on = pending[santa.id] ?? d.isSantaGift(claim.id, santa.id);
        return (
          <label key={santa.id} className="santa-tick">
            <input type="checkbox" checked={on} onChange={e => {
              const want = e.target.checked;
              setPending(p => ({ ...p, [santa.id]: want }));
              if (want) {
                run(() => actions.tagSantaGift(claim.id, santa.id, pair.giver_id)).then(r => {
                  settle(santa.id);
                  if (r.ok) setAsking({ santaId: santa.id, giverId: pair.giver_id, receiver: d.personById.get(pair.receiver_id)?.name ?? '' });
                });
              } else run(() => actions.untagSantaGift(claim.id, santa.id), 'Retiré du Secret Santa').then(() => settle(santa.id));
            }} />
            <SantaTickLabel giverId={pair.giver_id} santaName={santa.name} several={draws.length > 1} />
          </label>
        );
      })}
      {asking && <CompleteOrContinue {...asking} onClose={() => setAsking(null)} />}
    </>
  );
}

export function CompleteOrContinue({ santaId, giverId, receiver, onClose }: { santaId: string; giverId: string; receiver: string; onClose: () => void }) {
  const { d, data, actions, run } = useHotte();
  const gifts = d.santaGiftClaims(santaId, giverId);
  const titleOf = (c: Claim) => (c.wish_id ? data.wishes.find(w => w.id === c.wish_id)?.title : c.note) || 'Une surprise';
  return (
    <Modal title={`🎅 Ajouté à ton Secret Santa pour ${receiver}`} onClose={onClose}>
      <ul className="plain-list">{gifts.map(c => <li key={c.id}>{titleOf(c)}{c.amount ? ` · ${eur(c.amount)}` : ''}</li>)}</ul>
      <p>C’est tout pour {receiver}, ou tu cherches d’autres cadeaux pour le Secret Santa ?</p>
      <div className="row">
        <button className="btn" onClick={() => run(() => actions.setSantaDone(santaId, giverId, true), '✅ Secret Santa complet').then(onClose)}>✅ C’est complet</button>
        <button className="btn ghost" onClick={() => run(() => actions.setSantaDone(santaId, giverId, false)).then(onClose)}>Je continue</button>
      </div>
      <p className="note">Tu pourras changer d’avis à tout moment dans « Ce que j’offre ».</p>
    </Modal>
  );
}

const STATE = {
  none: '⏳ Rien de choisi',
  progress: '🛍️ En cours',
  done: '✅ Complet',
} as const;

/** Top of « Ce que j'offre »: one line per Secret Santa I take part in, with a status I set by hand. */
export function SantaTracker({ onOpenPerson }: { onOpenPerson: (personId: string, groupId: string) => void }) {
  const { d, data, actions, run } = useHotte();
  const [open, setOpen] = useState<string | null>(null);
  const draws = d.myDraws.filter(x => !d.isRevealed(x.santa));
  if (!draws.length) return null;
  const titleOf = (c: Claim) => (c.wish_id ? data.wishes.find(w => w.id === c.wish_id)?.title : c.note) || 'Une surprise';

  return (
    <section className="panel">
      <h2>🎅 Secret Santa</h2>
      {draws.map(({ pair, santa }) => {
        const giver = d.personById.get(pair.giver_id);
        const key = santa.id + pair.giver_id;
        const receiver = d.personById.get(pair.receiver_id);
        const state = d.santaGiftState(santa.id, pair.giver_id);
        const gifts = d.santaGiftClaims(santa.id, pair.giver_id);
        const isOpen = open === key;
        return (
          <div key={key} className="tracker">
            <div className="tracker-head">
              <div className="stack" style={{ gap: 2 }}>
                <span>{giver?.user_id === d.me ? '' : `${giver?.name} → `}<b>{receiver?.name ?? 'quelqu’un'}</b> <span className="who">· {santa.name} · {frDay(santa.event_date)}{santa.budget != null && ` · ${eur(santa.budget)}`}</span></span>
                <span className="who">{gifts.length ? `${gifts.length} cadeau${gifts.length > 1 ? 'x' : ''} choisi${gifts.length > 1 ? 's' : ''}` : 'Pas encore de cadeau choisi'}</span>
              </div>
              <div className="row">
                <select className={'select state-select state-' + state} aria-label={`Statut du Secret Santa pour ${receiver?.name ?? ''}`}
                  value={state === 'done' ? 'done' : 'progress'}
                  onChange={e => {
                    const done = e.target.value === 'done';
                    run(() => actions.setSantaDone(santa.id, pair.giver_id, done), done ? '✅ Secret Santa complet' : 'Repassé en cours');
                  }}>
                  <option value="progress">{state === 'none' ? STATE.none : STATE.progress}</option>
                  <option value="done">{STATE.done}</option>
                </select>
                {gifts.length
                  ? <button className="btn ghost sm" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : key)}>Voir les cadeaux {isOpen ? '▴' : '▾'}</button>
                  : receiver && <button className="btn ghost sm" onClick={() => onOpenPerson(receiver.id, santa.group_id)}>Voir ses envies</button>}
              </div>
            </div>
            {pair.changed_at && <span className="warn">Ce tirage a changé : une personne ne participe plus.</span>}
            {isOpen && (
              <div className="tracker-body">
                <ul className="plain-list">
                  {gifts.map(c => <li key={c.id}>{titleOf(c)}{c.amount ? ` · ${eur(c.amount)}` : ''}</li>)}
                </ul>
                {receiver && <button className="linkish" onClick={() => onOpenPerson(receiver.id, santa.group_id)}>Ajouter un autre cadeau (voir ses envies)</button>}
              </div>
            )}
          </div>
        );
      })}
    </section>
  );
}
