'use client';

import { useState } from 'react';
import { useHotte } from '@/lib/hotte';
import type { Claim } from '@/lib/types';
import { Modal } from './Modal';

/** « Je ne l'offre plus » / « Je ne participe plus », always confirmed: [Annuler] [action]. */
export function StopClaim({ claim: c, title }: { claim: Claim; title: string }) {
  const { data, actions, run } = useHotte();
  const [confirm, setConfirm] = useState(false);
  const label = c.kind === 'part' ? 'Je ne participe plus' : 'Je ne l’offre plus';
  // Say exactly what happens: an envie already removed or received is free for nobody.
  const w = c.wish_id ? data.wishes.find(x => x.id === c.wish_id) : undefined;
  const what = c.kind === 'other' ? 'Ton idée disparaît de sa page.'
    : c.kind === 'part' ? 'Ta part est retirée de la cagnotte.'
    : w && (w.removed || w.received_at) ? 'Il disparaît de « Ce que j’offre ».'
    : 'Le cadeau redevient libre pour les autres.';
  const forSanta = data.santaGifts.some(x => x.claim_id === c.id);
  return (
    <>
      <button className="btn ghost sm" onClick={() => setConfirm(true)}>{label}</button>
      {confirm && (
        <Modal title={c.kind === 'part' ? `Ne plus participer à « ${title} » ?` : `Ne plus offrir « ${title} » ?`} onClose={() => setConfirm(false)}>
          <p className="note">{what}{forSanta && ' Il est aussi retiré de ton Secret Santa.'}</p>
          <div className="row modal-actions">
            <button className="btn ghost" onClick={() => setConfirm(false)}>Annuler</button>
            <button className="btn danger" onClick={() => run(() => actions.cancelClaim(c.id), c.kind === 'part' ? `Tu ne participes plus à « ${title} »` : `Tu n’offres plus « ${title} »`).then(() => setConfirm(false))}>{label}</button>
          </div>
        </Modal>
      )}
    </>
  );
}
