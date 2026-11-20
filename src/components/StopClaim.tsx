'use client';

import { useState } from 'react';
import { useHotte } from '@/lib/hotte';
import type { Claim } from '@/lib/types';
import { Modal } from './Modal';

/** « Je ne l'offre plus » / « Je ne participe plus », always confirmed: [Annuler] [action]. */
export function StopClaim({ claim: c, title }: { claim: Claim; title: string }) {
  const { actions, run } = useHotte();
  const [confirm, setConfirm] = useState(false);
  const label = c.kind === 'part' ? 'Je ne participe plus' : 'Je ne l’offre plus';
  return (
    <>
      <button className="btn ghost sm" onClick={() => setConfirm(true)}>{label}</button>
      {confirm && (
        <Modal title={c.kind === 'part' ? `Ne plus participer à « ${title} » ?` : `Ne plus offrir « ${title} » ?`} onClose={() => setConfirm(false)}>
          <p className="note">Le cadeau redevient libre pour les autres.</p>
          <div className="row modal-actions">
            <button className="btn ghost" onClick={() => setConfirm(false)}>Annuler</button>
            <button className="btn danger" onClick={() => run(() => actions.cancelClaim(c.id), `« ${title} » annulé`).then(() => setConfirm(false))}>{label}</button>
          </div>
        </Modal>
      )}
    </>
  );
}
