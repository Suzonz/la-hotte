'use client';

import { useState } from 'react';
import { useHotte } from '@/lib/hotte';
import { plural } from '@/lib/format';

/**
 * « Préparer l'année prochaine » : my received envies (and my children's) leave
 * the lists, the gifts I marked as given leave « Ce que j'offre ». Shown only
 * when there is something to tidy.
 */
export function NewSeason() {
  const { d, data, actions, run } = useHotte();
  const [confirm, setConfirm] = useState(false);
  const mine = [d.myPerson, ...d.myKids].filter(Boolean).map(p => p!.id);
  const received = data.wishes.filter(w => mine.includes(w.person_id) && w.received_at && !w.removed).length;
  const offered = d.myClaims.filter(c => c.offered_at).length;
  if (!received && !offered) return null;

  const what = [received ? `${plural(received, 'envie reçue', 'envies reçues')} quitteront les listes` : '',
                offered ? `${plural(offered, 'cadeau offert', 'cadeaux offerts')} quitteront « Ce que j’offre »` : '']
    .filter(Boolean).join(', et ');

  return (
    <section className="panel">
      <h2>🎄 Préparer l’année prochaine</h2>
      <p className="note">Range ce qui est fini : {what}. Le reste de tes envies est conservé.</p>
      {confirm ? (
        <div className="row">
          <span className="who">On range ?</span>
          <button className="btn sm" onClick={() => run(() => actions.newSeason(), 'C’est rangé. À l’année prochaine !').then(() => setConfirm(false))}>Oui, ranger</button>
          <button className="btn ghost sm" onClick={() => setConfirm(false)}>Pas encore</button>
        </div>
      ) : <div><button className="btn alt sm" onClick={() => setConfirm(true)}>Ranger</button></div>}
    </section>
  );
}
