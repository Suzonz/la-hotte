'use client';

import { useState } from 'react';
import { useHotte } from '@/lib/hotte';
import { emptyDraft, type Person, type Wish, type WishDraft } from '@/lib/types';
import { WishBody } from './WishBody';
import { WishForm } from './WishForm';
import { Modal } from './Modal';

const byWant = (a: Wish, b: Wish) => b.stars - a.stars;

/** « Ajouter une envie » for me or one of my children. */
export function AddWish({ person }: { person: Person }) {
  const { d, actions, run } = useHotte();
  const [draft, setDraft] = useState<WishDraft>(emptyDraft);
  const isMe = person.user_id === d.me;
  // Open while the list is empty; afterwards a button, so the list shows first (on a phone above all).
  const hasWishes = d.wishesOf(person.id).some(w => !w.removed);
  const [open, setOpen] = useState(!hasWishes);
  const title = isMe ? 'Ajouter une envie' : `Ajouter une envie pour ${person.name}`;

  const add = () => run(async () => {
    const groups = await actions.addWish(person.id, draft);
    setDraft(emptyDraft());
    return groups;
  }, groups => groups.length
    ? 'Ajouté, visible par ' + groups.map(g => '« ' + (d.groupById.get(g)?.name ?? '') + ' »').join(' et ')
    : 'Ajouté dans les envies privées').then(r => { if (r.ok) setOpen(false); });

  if (!open) {
    return <div><button className="btn" onClick={() => setOpen(true)}>＋ {title}</button></div>;
  }
  return (
    <section className="panel">
      <h2>{title}</h2>
      <WishForm draft={draft} onChange={setDraft} onSubmit={add} submitLabel="Ajouter" onCancel={hasWishes ? () => setOpen(false) : undefined} />
    </section>
  );
}

type Filter = 'all' | 'private' | string;   // string = a group id

/** All envies of a person I manage, in one list, with « who sees it » tags and a filter. */
export function WishList({ person }: { person: Person }) {
  const { d } = useHotte();
  const [filter, setFilter] = useState<Filter>('all');
  const live = d.wishesOf(person.id).filter(w => !w.removed && !w.received_at).sort(byWant);
  const received = d.wishesOf(person.id).filter(w => !w.removed && w.received_at);
  const visibleGroups = (w: Wish) => d.groupsOfWish(w.id).filter(g => d.myGroupIds.includes(g));
  const count = (f: Filter) => live.filter(w => matches(w, f)).length;
  const matches = (w: Wish, f: Filter) => f === 'all' || (f === 'private' ? visibleGroups(w).length === 0 : visibleGroups(w).includes(f));
  const shown = live.filter(w => matches(w, filter));
  const hasPrivate = count('private') > 0;

  const heading = person.user_id === d.me ? 'Mes envies' : 'Ses envies';   // the page title already has the name

  if (!live.length) {
    return (
      <>
        <section className="panel">
          <h2>{heading}</h2>
          <p className="note">Aucune envie pour l’instant. Ajoute la première au-dessus.</p>
        </section>
        <ReceivedList wishes={received} />
      </>
    );
  }

  return (
    <>
    <section className="panel">
      <div className="listhead">
        <h2>{heading} ({live.length})</h2>
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
    <ReceivedList wishes={received} />
    </>
  );
}

/** Drawn, not an emoji: the 🗑️ emoji is pale grey on Windows. Takes the text colour. */
function TrashIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="block">
      <path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6M10 11v6M14 11v6" />
    </svg>
  );
}

/** A « Reçu » box follows the click at once; if saving fails, it goes back. */
function undoIfFailed(box: HTMLInputElement, done: Promise<{ ok: boolean }>) {
  done.then(r => { if (!r.ok && box.isConnected) box.checked = !box.checked; });
}

/** « Cadeaux reçus », under the list. Unticking one sends it back to the list. */
function ReceivedList({ wishes }: { wishes: Wish[] }) {
  const { d, actions, run } = useHotte();
  if (!wishes.length) return null;
  return (
    <section className="panel received">
      <h2>Cadeaux reçus ({wishes.length})</h2>
      <ul className="items">
        {wishes.map(w => {
          const groups = d.groupsOfWish(w.id).filter(g => d.myGroupIds.includes(g));
          const tags = (
            <span className="tags">
              {groups.length
                ? groups.map(g => <span key={g} className="chip free">{d.groupById.get(g)?.name}</span>)
                : <span className="chip pot">🔒 Privée</span>}
            </span>
          );
          return (
            <li key={w.id} className="item done">
              <WishBody wish={w} extra={tags} />
              <label className="tick">
                <input type="checkbox" defaultChecked
                  onChange={e => undoIfFailed(e.currentTarget, run(() => actions.setReceived(w.id, false), `« ${w.title} » est de retour dans la liste`))} />
                Reçu
              </label>
            </li>
          );
        })}
      </ul>
      <p className="note">Les cadeaux reçus sont supprimés au bout d’un mois.</p>
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
            <li key={w.id} className="item editing">
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
        const tools = (
          <span className="title-tools">
            <button className="icon-btn" aria-label="Modifier" title="Modifier" onClick={() => {
              setEdit({ title: w.title, link: w.link ?? '', price: w.price != null ? String(w.price) : '', stars: w.stars, note: w.note, groups, privateOnly: groups.length === 0 });
              setEditing(w.id);
            }}>✏️</button>
            <button className="icon-btn" aria-label="Supprimer" title="Supprimer" onClick={() => setConfirmDel(w.id)}><TrashIcon /></button>
          </span>
        );
        return (
          <li key={w.id} className="item">
            <WishBody wish={w} extra={tags} tools={tools} />
            <label className="tick">
              <input type="checkbox" defaultChecked={false}
                onChange={e => undoIfFailed(e.currentTarget, run(() => actions.setReceived(w.id, true), `« ${w.title} » est dans tes cadeaux reçus 🎁`))} />
              Reçu
            </label>
          </li>
        );
      })}
      {confirmDel && (() => {
        const w = wishes.find(x => x.id === confirmDel);
        if (!w) return null;
        return (
          <Modal title={`Supprimer « ${w.title} » ?`} onClose={() => setConfirmDel(null)}>
            <p className="note">Si quelqu’un l’avait choisie, cette personne sera prévenue.</p>
            <div className="row modal-actions">
              <button className="btn ghost" onClick={() => setConfirmDel(null)}>Annuler</button>
              <button className="btn danger" onClick={() => run(() => actions.removeWish(w.id), 'Envie supprimée').then(() => setConfirmDel(null))}>Supprimer</button>
            </div>
          </Modal>
        );
      })()}
    </ul>
  );
}
