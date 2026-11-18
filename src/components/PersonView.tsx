'use client';

import { useState } from 'react';
import { useHotte } from '@/lib/hotte';
import { eur, parseAmount } from '@/lib/format';
import type { Person } from '@/lib/types';
import { ManageWishes } from './ManageWishes';
import { WishCard } from './WishCard';

/** Another person's page, or my child's (then with the management tools on top). */
export function PersonView({ person, onLeave }: { person: Person; onLeave: () => void }) {
  const { d, actions, run } = useHotte();
  const iManage = person.manager_id === d.me;
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(person.name);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const claims = d.claimsFor(person.id);
  const wishes = d.wishesOf(person.id)
    .filter(w => !w.removed || claims.some(c => c.wish_id === w.id))
    .filter(w => !iManage || w.removed || d.groupsOfWish(w.id).length > 0 || claims.some(c => c.wish_id === w.id))
    .sort((a, b) => Number(a.removed) - Number(b.removed) || b.stars - a.stars);
  const common = d.commonGroups(person).map(g => g.name);
  const manager = person.manager_id ? d.personByUser.get(person.manager_id) : null;

  return (
    <>
      <div>
        <span className="eyebrow">{person.manager_id ? `Envies gérées par ${iManage ? 'toi' : manager?.name ?? 'un parent'}` : 'Les envies de'}</span>
        {iManage && renaming ? (
          <form className="row" onSubmit={e => { e.preventDefault(); run(() => actions.renamePerson(person.id, name), 'Prénom modifié').then(r => r.ok && setRenaming(false)); }}>
            <input aria-label="Prénom" value={name} maxLength={40} style={{ maxWidth: 240 }} autoFocus onChange={e => setName(e.target.value)} />
            <button className="btn sm" type="submit">Enregistrer</button>
            <button className="btn ghost sm" type="button" onClick={() => setRenaming(false)}>Annuler</button>
          </form>
        ) : (
          <div className="row">
            <h1>{person.name}</h1>
            {iManage && <button className="linkish" onClick={() => { setName(person.name); setRenaming(true); }}>Changer le prénom</button>}
          </div>
        )}
        <p className="sub">
          {iManage
            ? 'Tu gères ses envies. Tout le monde voit ce qui est réservé dessus, toi compris, pour éviter les doublons.'
            : `${person.manager_id ? '' : person.name + ' ne voit pas ce qui est réservé sur ses envies. '}Groupes en commun : ${common.join(', ') || 'aucun'}.`}
        </p>
      </div>

      {iManage && (
        <>
          <ManageWishes person={person} />
          <div className="row">
            {confirmDelete ? (
              <>
                <span className="who">Supprimer {person.name} et toutes ses envies ?</span>
                <button className="btn danger sm" onClick={() => run(() => actions.removeKid(person.id), `${person.name} supprimé(e)`).then(r => r.ok && onLeave())}>Supprimer</button>
                <button className="btn ghost sm" onClick={() => setConfirmDelete(false)}>Garder</button>
              </>
            ) : <button className="btn ghost sm" onClick={() => setConfirmDelete(true)}>Supprimer l’enfant</button>}
          </div>
          <h2>Les réservations sur ses envies</h2>
        </>
      )}

      {wishes.length === 0
        ? <div className="empty">{person.name} n’a encore rien rangé dans vos groupes communs. Tu peux quand même prévoir un cadeau hors liste plus bas.</div>
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

  const save = () => {
    if (!note.trim()) return toast('Décris ton idée en quelques mots.');
    run(() => actions.claim(person.id, 'other', { note: note.slice(0, 200), amount: parseAmount(amount) }), 'Noté')
      .then(r => { if (r.ok) { setOpen(false); setNote(''); setAmount(''); } });
  };

  return (
    <section className="panel">
      <h2>Cadeaux hors liste pour {person.name}</h2>
      <p className="note">Pour une surprise qui n’est pas dans ses envies. Indique-la ici pour que deux personnes n’aient pas la même idée.</p>
      {offs.length > 0 && (
        <div>
          {offs.map(c => (
            <div key={c.id} className="gline">
              <span className="t"><b>{c.claimer_id === d.me ? 'Toi' : d.whoName(c.claimer_id)}</b> : {c.note || 'une surprise'}</span>
              <span className="row">
                {c.amount ? <span className="a">{eur(c.amount)}</span> : null}
                {c.claimer_id === d.me && <button className="btn ghost sm" onClick={() => run(() => actions.cancelClaim(c.id), 'Annulé')}>Annuler</button>}
              </span>
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
          <div className="row full">
            <button className="btn" type="submit">Enregistrer</button>
            <button className="btn ghost" type="button" onClick={() => setOpen(false)}>Annuler</button>
          </div>
        </form>
      ) : <div className="row"><button className="btn alt sm" onClick={() => setOpen(true)}>J’offre autre chose</button></div>}
    </section>
  );
}
