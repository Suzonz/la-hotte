'use client';

import { useState } from 'react';
import { useHotte } from '@/lib/hotte';

/** « Mes groupes ▾ → ＋ Nouveau groupe » */
export function NewGroupPage({ onCreated, onCancel }: { onCreated: (groupId: string) => void; onCancel: () => void }) {
  const { actions, run } = useHotte();
  const [name, setName] = useState('');
  const submit = () => {
    if (!name.trim()) return;
    let id = '';
    run(async () => { id = await actions.createGroup(name); }, `Groupe « ${name.trim()} » créé : invite des personnes avec son lien`)
      .then(r => r.ok && onCreated(id));
  };
  return (
    <>
      <div>
        <span className="eyebrow">Mes groupes</span>
        <h1>Nouveau groupe</h1>
        <p className="sub">Un groupe, ce sont les personnes qui verront les envies que tu y ranges : la famille, les amis, les collègues…</p>
      </div>
      <form className="panel" onSubmit={e => { e.preventDefault(); submit(); }}>
        <label>Nom du groupe
          <input value={name} maxLength={50} autoFocus placeholder="Ex. Famille, Collègues" onChange={e => setName(e.target.value)} />
        </label>
        <div className="row">
          <button className="btn" type="submit" disabled={!name.trim()}>Créer le groupe</button>
          <button className="btn ghost" type="button" onClick={onCancel}>Annuler</button>
        </div>
        <p className="note">Tu pourras ensuite copier son lien d’invitation pour y faire entrer les autres.</p>
      </form>
    </>
  );
}

/** « Ma liste ▾ → ＋ Ajouter un enfant » */
export function AddKidPage({ onCreated, onCancel }: { onCreated: (personId: string) => void; onCancel: () => void }) {
  const { actions, run } = useHotte();
  const [name, setName] = useState('');
  const submit = () => {
    if (!name.trim()) return;
    let id = '';
    run(async () => { id = await actions.addKid(name); }, `Liste de ${name.trim()} créée`).then(r => r.ok && onCreated(id));
  };
  return (
    <>
      <div>
        <span className="eyebrow">Ma liste</span>
        <h1>Ajouter un enfant</h1>
        <p className="sub">Pour un enfant sans compte : tu remplis ses envies à sa place et tu choisis quels groupes les voient. Tu vois aussi ce qui est réservé dessus, pour éviter d’acheter en double.</p>
      </div>
      <form className="panel" onSubmit={e => { e.preventDefault(); submit(); }}>
        <label>Prénom de l’enfant
          <input value={name} maxLength={40} autoFocus placeholder="Ex. Léo" onChange={e => setName(e.target.value)} />
        </label>
        <div className="row">
          <button className="btn" type="submit" disabled={!name.trim()}>Créer sa liste</button>
          <button className="btn ghost" type="button" onClick={onCancel}>Annuler</button>
        </div>
      </form>
    </>
  );
}
