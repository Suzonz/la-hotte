'use client';

import { useState } from 'react';
import { useHotte } from '@/lib/hotte';
import type { Person } from '@/lib/types';
import { AddWish, WishList } from './ManageWishes';
import { NewSeason } from './NewSeason';
import { WishCard } from './WishCard';

/** The parents of a child: all equal, each can add the other or take them off. */
function KidParents({ kid }: { kid: Person }) {
  const { d, data, actions, run } = useHotte();
  const [adding, setAdding] = useState(false);
  const [confirm, setConfirm] = useState<string | null>(null);
  const parents = d.accountsOf(kid);
  const nameOf = (u: string) => (u === d.me ? 'Toi' : d.personByUser.get(u)?.name ?? 'Un parent');
  // People I already share a group with (accounts), who are not parents yet.
  const candidates = data.persons.filter(p => p.user_id && p.user_id !== d.me && !parents.includes(p.user_id));

  return (
    <section className="panel">
      <h2>Parents de {kid.name}</h2>
      <p className="note">Chaque parent peut remplir sa liste, voir ce qui est réservé dessus, et ranger ses envies dans ses propres groupes.</p>
      <ul className="members">
        {parents.map(u => (
          <li key={u}>
            <span>{nameOf(u)}</span>
            {parents.length > 1 && (confirm === u ? (
              <span className="row">
                <span className="who">{u === d.me ? `Ne plus gérer la liste de ${kid.name} ?` : `${nameOf(u)} ne gérera plus la liste de ${kid.name}.`}</span>
                <button className="btn danger sm" onClick={() => run(() => actions.removeParent(kid.id, u), u === d.me ? `Tu ne gères plus la liste de ${kid.name}` : 'C’est fait').then(() => setConfirm(null))}>Confirmer</button>
                <button className="btn ghost sm" onClick={() => setConfirm(null)}>Annuler</button>
              </span>
            ) : <button className="link-btn" onClick={() => setConfirm(u)}>{u === d.me ? 'Me retirer' : 'Retirer'}</button>)}
          </li>
        ))}
      </ul>
      {adding ? (
        candidates.length ? (
          <div className="stack" style={{ alignItems: 'stretch' }}>
            <span className="eyebrow">Avec qui partager la gestion ?</span>
            <div className="row">
              {candidates.map(p => (
                <button key={p.id} className="btn alt sm" onClick={() => run(() => actions.addCoParent(kid.id, p.user_id!), `${p.name} gère aussi la liste de ${kid.name}`).then(r => r.ok && setAdding(false))}>{p.name}</button>
              ))}
              <button className="btn ghost sm" onClick={() => setAdding(false)}>Annuler</button>
            </div>
          </div>
        ) : <p className="note">L’autre parent doit d’abord être dans un de tes groupes. Invite-le avec le lien d’un groupe, puis reviens ici.</p>
      ) : <div><button className="link-btn" onClick={() => setAdding(true)}>+ Partager la gestion</button></div>}
    </section>
  );
}

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
        <span className="eyebrow">{isMe ? 'Ma liste' : `Liste gérée par ${d.parentNames(person)}`}</span>
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

      {!isMe && <KidParents kid={person} />}

      {isMe && <NewSeason />}

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
