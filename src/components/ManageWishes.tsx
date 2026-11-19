'use client';

import { useState } from 'react';
import { useHotte } from '@/lib/hotte';
import { emptyDraft, type Person, type Wish, type WishDraft } from '@/lib/types';
import { WishBody } from './WishBody';
import { WishForm } from './WishForm';

const byWant = (a: Wish, b: Wish) => b.stars - a.stars;

/** « Ajouter une envie » for me or one of my children. */
export function AddWish({ person }: { person: Person }) {
  const { d, actions, run } = useHotte();
  const [draft, setDraft] = useState<WishDraft>(emptyDraft);
  const isMe = person.user_id === d.me;

  const add = () => run(async () => {
    const groups = await actions.addWish(person.id, draft);
    setDraft(emptyDraft());
    return groups;
  }, groups => groups.length
    ? 'Ajouté, visible par ' + groups.map(g => '« ' + (d.groupById.get(g)?.name ?? '') + ' »').join(' et ')
    : 'Ajouté dans les envies privées');

  return (
    <section className="panel">
      <h2>{isMe ? 'Ajouter une envie' : `Ajouter une envie pour ${person.name}`}</h2>
      <WishForm draft={draft} onChange={setDraft} onSubmit={add} submitLabel="Ajouter" />
    </section>
  );
}

type Filter = 'all' | 'private' | string;   // string = a group id

/** All envies of a person I manage, in one list, with « who sees it » tags and a filter. */
export function WishList({ person }: { person: Person }) {
  const { d } = useHotte();
  const [filter, setFilter] = useState<Filter>('all');
  const live = d.wishesOf(person.id).filter(w => !w.removed).sort(byWant);
  const visibleGroups = (w: Wish) => d.groupsOfWish(w.id).filter(g => d.myGroupIds.includes(g));
  const count = (f: Filter) => live.filter(w => matches(w, f)).length;
  const matches = (w: Wish, f: Filter) => f === 'all' || (f === 'private' ? visibleGroups(w).length === 0 : visibleGroups(w).includes(f));
  const shown = live.filter(w => matches(w, filter));
  const hasPrivate = count('private') > 0;

  if (!live.length) {
    return <div className="empty">Aucune envie pour l’instant. Ajoute la première au-dessus.</div>;
  }

  return (
    <section className="stack" style={{ alignItems: 'stretch', gap: 12 }}>
      <div className="listhead">
        <h2>{person.user_id === d.me ? 'Mes envies' : `Les envies de ${person.name}`} ({live.length})</h2>
      </div>
      {(d.myGroups.length > 0 || hasPrivate) && (
        <div className="filters" role="group" aria-label="Filtrer par groupe">
          <button aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>Toutes ({live.length})</button>
          {d.myGroups.map(g => (
            <button key={g.id} aria-pressed={filter === g.id} onClick={() => setFilter(g.id)}>{g.name} ({count(g.id)})</button>
          ))}
          {hasPrivate && <button aria-pressed={filter === 'private'} onClick={() => setFilter('private')}>🔒 Privées ({count('private')})</button>}
        </div>
      )}
      {filter !== 'all' && filter !== 'private' && (
        <p className="note">Ce que voient les membres de « {d.groupById.get(filter)?.name} ».</p>
      )}
      {shown.length
        ? <OwnWishList wishes={shown} />
        : <div className="empty">Aucune envie dans ce filtre.</div>}
    </section>
  );
}

function OwnWishList({ wishes }: { wishes: Wish[] }) {
  const { d, actions, run } = useHotte();
  const [editing, setEditing] = useState<string | null>(null);
  const [edit, setEdit] = useState<WishDraft>(emptyDraft);
  const [confirmDel, setConfirmDel] = useState<string | null>(null);

  return (
    <ul className="items">
      {wishes.map(w => {
        const groups = d.groupsOfWish(w.id).filter(g => d.myGroupIds.includes(g));
        if (editing === w.id) {
          return (
            <li key={w.id} className="item">
              <WishForm draft={edit} onChange={setEdit} submitLabel="Enregistrer" onCancel={() => setEditing(null)}
                onSubmit={() => run(() => actions.updateWish(w.id, edit), 'Modifié').then(r => { if (r.ok) setEditing(null); })} />
            </li>
          );
        }
        const tags = (
          <span className="tags">
            {groups.length
              ? groups.map(g => <span key={g} className="chip free">{d.groupById.get(g)?.name}</span>)
              : <span className="chip pot">🔒 Privée</span>}
          </span>
        );
        return (
          <li key={w.id} className="item">
            <WishBody wish={w} extra={tags} />
            <div className="row">
              {confirmDel === w.id ? (
                <>
                  <span className="who">Retirer cette envie ?</span>
                  <button className="btn danger sm" onClick={() => run(() => actions.removeWish(w.id), 'Retiré').then(() => setConfirmDel(null))}>Retirer</button>
                  <button className="btn ghost sm" onClick={() => setConfirmDel(null)}>Garder</button>
                </>
              ) : (
                <>
                  <button className="btn ghost sm" onClick={() => {
                    setEdit({ title: w.title, link: w.link ?? '', price: w.price != null ? String(w.price) : '', stars: w.stars, note: w.note, groups, privateOnly: groups.length === 0 });
                    setEditing(w.id);
                  }}>Modifier</button>
                  <button className="btn ghost sm" onClick={() => setConfirmDel(w.id)}>Retirer</button>
                </>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
