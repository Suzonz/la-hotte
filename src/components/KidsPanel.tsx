'use client';

import { useState } from 'react';
import { useHotte } from '@/lib/hotte';
import { plural } from '@/lib/format';

export function KidsPanel({ onOpen }: { onOpen: (personId: string) => void }) {
  const { d, actions, run } = useHotte();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');

  const add = () => {
    if (!name.trim()) return;
    let id = '';
    run(async () => { id = await actions.addKid(name); }, `Liste de ${name.trim()} créée`)
      .then(r => { if (r.ok) { setAdding(false); setName(''); onOpen(id); } });
  };

  return (
    <section className="panel">
      <h2>Enfants que je gère</h2>
      <p className="note">Pour un enfant sans compte : tu remplis ses envies à sa place et tu les ranges dans tes groupes. Toi aussi, tu vois ce qui est réservé dessus, pour éviter d’acheter en double.</p>
      {d.myKids.length > 0 && (
        <div className="row">
          {d.myKids.map(k => (
            <button key={k.id} className="tab" onClick={() => onOpen(k.id)}>
              {k.name} · {plural(d.wishesOf(k.id).filter(w => !w.removed).length, 'envie')}
            </button>
          ))}
        </div>
      )}
      {adding ? (
        <form className="row" onSubmit={e => { e.preventDefault(); add(); }}>
          <input aria-label="Prénom de l’enfant" value={name} maxLength={40} autoFocus style={{ maxWidth: 240 }}
            placeholder="Prénom de l’enfant" onChange={e => setName(e.target.value)} />
          <button className="btn sm" type="submit">Créer sa liste</button>
          <button className="btn ghost sm" type="button" onClick={() => setAdding(false)}>Annuler</button>
        </form>
      ) : (
        <div className="row"><button className="btn alt sm" onClick={() => setAdding(true)}>Ajouter un enfant</button></div>
      )}
    </section>
  );
}
