'use client';

import { useState } from 'react';
import { useHotte } from '@/lib/hotte';
import type { Person } from '@/lib/types';
import { AddWish, WishList } from './ManageWishes';
import { WishCard } from './WishCard';

/** « Ma liste » : my envies, or those of a child I manage. */
export function ListPage({ person, onDeleted }: { person: Person; onDeleted: () => void }) {
  const { d, actions, run } = useHotte();
  const isMe = person.user_id === d.me;
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(person.name);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // For a child, the parent also sees what has been reserved on their envies.
  const reserved = isMe ? [] : d.wishesOf(person.id).filter(w => d.claimsOn(w.id).length > 0);

  return (
    <>
      <div>
        <span className="eyebrow">{isMe ? 'Ma liste' : 'Liste gérée par toi'}</span>
        {renaming ? (
          <form className="row" onSubmit={e => { e.preventDefault(); run(() => actions.renamePerson(person.id, name), 'Prénom modifié').then(r => r.ok && setRenaming(false)); }}>
            <input aria-label="Prénom" value={name} maxLength={40} style={{ maxWidth: 240 }} autoFocus onChange={e => setName(e.target.value)} />
            <button className="btn sm" type="submit">Enregistrer</button>
            <button className="btn ghost sm" type="button" onClick={() => setRenaming(false)}>Annuler</button>
          </form>
        ) : (
          <div className="row">
            <h1>Les envies de {person.name}</h1>
            <button className="icon-btn" title="Changer le prénom" aria-label="Changer le prénom" onClick={() => { setName(person.name); setRenaming(true); }}>✏️</button>
          </div>
        )}
        <p className="note">
          {isMe
            ? <><b>Tu ne vois jamais ce que les autres te préparent.</b> Pour chaque envie, tu choisis qui la voit.</>
            : <>Tu remplis ses envies à sa place. Toi aussi, tu vois ce qui est réservé dessus, pour éviter d’acheter en double.</>}
        </p>
      </div>

      <AddWish person={person} />
      <WishList person={person} />

      {!isMe && reserved.length > 0 && (
        <section className="stack" style={{ alignItems: 'stretch', gap: 12 }}>
          <h2>Déjà réservé sur ses envies</h2>
          <ul className="items">{reserved.map(w => <WishCard key={w.id} person={person} wish={w} claims={d.claimsOn(w.id)} />)}</ul>
        </section>
      )}

      {isMe
        ? <p className="note">Si tu retires une envie que quelqu’un avait déjà prise, cette personne est prévenue. Toi, tu ne le sauras pas.</p>
        : (
          <div className="row">
            {confirmDelete ? (
              <>
                <span className="who">Supprimer la liste de {person.name} et toutes ses envies ?</span>
                <button className="btn danger sm" onClick={() => run(() => actions.removeKid(person.id), `Liste de ${person.name} supprimée`).then(r => r.ok && onDeleted())}>Supprimer</button>
                <button className="btn ghost sm" onClick={() => setConfirmDelete(false)}>Garder</button>
              </>
            ) : <button className="btn ghost sm" onClick={() => setConfirmDelete(true)}>Supprimer la liste de {person.name}</button>}
          </div>
        )}
    </>
  );
}
