'use client';

import { useState } from 'react';
import { useHotte } from '@/lib/hotte';
import { plural } from '@/lib/format';
import { emptyDraft, type Person, type Wish, type WishDraft } from '@/lib/types';
import { WishBody } from './WishBody';
import { WishForm } from './WishForm';

const byWant = (a: Wish, b: Wish) => b.stars - a.stars;

/**
 * For a person I manage (me, or one of my children): the add form at the top,
 * then one box per group with its envies, then the envies no group can see.
 */
export function ManageWishes({ person }: { person: Person }) {
  const { d, actions, run } = useHotte();
  const [draft, setDraft] = useState<WishDraft>(emptyDraft);
  const live = d.wishesOf(person.id).filter(w => !w.removed);
  const isMe = person.user_id === d.me;

  const add = () => run(async () => {
    const groups = await actions.addWish(person.id, draft);
    setDraft(emptyDraft());
    return groups;
  }, groups => 'Ajouté pour ' + groups.map(g => '« ' + (d.groupById.get(g)?.name ?? '') + ' »').join(' et '));

  const orphans = live.filter(w => !d.groupsOfWish(w.id).some(g => d.myGroupIds.includes(g))).sort(byWant);

  return (
    <>
      {d.myGroups.length > 0 && (
        <section className="panel">
          <h2>{isMe ? 'Ajouter une envie' : `Ajouter une envie pour ${person.name}`}</h2>
          <WishForm draft={draft} onChange={setDraft} onSubmit={add} submitLabel="Ajouter" />
        </section>
      )}

      {d.myGroups.map(g => {
        const items = live.filter(w => d.groupsOfWish(w.id).includes(g.id)).sort(byWant);
        const seenBy = d.membersOf(g.id).filter(m => m.user_id !== d.me).length;
        return (
          <section key={g.id} className="panel group-box">
            <div className="listhead">
              <h2><span className="eyebrow">Groupe</span><br />{g.name}</h2>
              <span className="chip free">Vu par {plural(seenBy, 'personne')}</span>
            </div>
            {items.length
              ? <OwnWishList wishes={items} inGroup={g.id} />
              : <p className="note">Aucune envie dans ce groupe pour l’instant. Ajoute-en une et coche « {g.name} ».</p>}
          </section>
        );
      })}

      {orphans.length > 0 && (
        <section className="panel group-box orphan">
          <div className="listhead">
            <h2>Envies sans groupe</h2>
            <span className="chip bought">Visibles par personne</span>
          </div>
          <p className="note">
            {d.myGroups.length
              ? 'Clique sur « Modifier » et coche un groupe pour que quelqu’un les voie.'
              : 'Crée d’abord un groupe en haut, puis range-les dedans avec « Modifier ».'}
          </p>
          <OwnWishList wishes={orphans} inGroup="none" />
        </section>
      )}
    </>
  );
}

function OwnWishList({ wishes, inGroup }: { wishes: Wish[]; inGroup: string }) {
  const { d, actions, run } = useHotte();
  const [editing, setEditing] = useState<string | null>(null);
  const [edit, setEdit] = useState<WishDraft>(emptyDraft);
  const [confirmDel, setConfirmDel] = useState<string | null>(null);

  return (
    <ul className="items">
      {wishes.map(w => {
        if (editing === w.id) {
          return (
            <li key={w.id} className="item">
              <WishForm draft={edit} onChange={setEdit} submitLabel="Enregistrer" onCancel={() => setEditing(null)}
                onSubmit={() => run(() => actions.updateWish(w.id, edit), 'Modifié').then(r => { if (r.ok) setEditing(null); })} />
            </li>
          );
        }
        const groups = d.groupsOfWish(w.id).filter(g => d.myGroupIds.includes(g));
        const also = groups.filter(g => g !== inGroup).map(g => d.groupById.get(g)?.name);
        return (
          <li key={w.id} className="item">
            <WishBody wish={w} extra={also.length > 0 && <span className="chip pot">Aussi dans {also.join(', ')}</span>} />
            <div className="row">
              {confirmDel === w.id ? (
                <>
                  <span className="who">{also.length ? 'Retirer cette envie de tous ses groupes ?' : 'Retirer cette envie ?'}</span>
                  <button className="btn danger sm" onClick={() => run(() => actions.removeWish(w.id), 'Retiré').then(() => setConfirmDel(null))}>Retirer</button>
                  <button className="btn ghost sm" onClick={() => setConfirmDel(null)}>Garder</button>
                </>
              ) : (
                <>
                  <button className="btn ghost sm" onClick={() => {
                    setEdit({ title: w.title, link: w.link ?? '', price: w.price != null ? String(w.price) : '', stars: w.stars, note: w.note, groups });
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
