'use client';

import { useId } from 'react';
import { useHotte } from '@/lib/hotte';
import { WANT_LABEL, wantStars } from '@/lib/format';
import type { WishDraft } from '@/lib/types';

type Props = {
  draft: WishDraft;
  onChange: (d: WishDraft) => void;
  onSubmit: () => void;
  submitLabel: string;
  onCancel?: () => void;
};

/** The envie form. No group is ever pre-selected: the owner must tick at least one. */
export function WishForm({ draft, onChange, onSubmit, submitLabel, onCancel }: Props) {
  const { d, busy } = useHotte();
  const id = useId();
  const set = <K extends keyof WishDraft>(k: K, v: WishDraft[K]) => onChange({ ...draft, [k]: v });
  // A group and « Seulement moi » exclude each other.
  const toggleGroup = (gid: string, on: boolean) =>
    onChange({ ...draft, privateOnly: false, groups: on ? [...draft.groups, gid] : draft.groups.filter(g => g !== gid) });
  const togglePrivate = (on: boolean) => onChange({ ...draft, privateOnly: on, groups: on ? [] : draft.groups });

  return (
    <form className="grid" onSubmit={e => { e.preventDefault(); onSubmit(); }}>
      <label className="full" htmlFor={id + 'title'}>Le cadeau
        <input id={id + 'title'} value={draft.title} maxLength={120} required placeholder="Ex. Casque audio sans fil"
          onChange={e => set('title', e.target.value)} />
      </label>
      <label htmlFor={id + 'link'}>Lien (facultatif)
        <input id={id + 'link'} value={draft.link} inputMode="url" placeholder="https://…" onChange={e => set('link', e.target.value)} />
      </label>
      <label htmlFor={id + 'price'}>Prix environ (€)
        <input id={id + 'price'} value={draft.price} inputMode="decimal" placeholder="Ex. 45" onChange={e => set('price', e.target.value)} />
      </label>
      <div className="full">
        <span className="eyebrow">Envie</span>
        <div className="stars" role="group" aria-label="Envie">
          {[1, 2, 3].map(s => (
            <button key={s} type="button" aria-pressed={draft.stars === s} onClick={() => set('stars', s)}>
              {wantStars(s)} {WANT_LABEL[s]}
            </button>
          ))}
        </div>
      </div>
      <label className="full" htmlFor={id + 'note'}>Précisions (taille, couleur…)
        <textarea id={id + 'note'} rows={2} maxLength={400} value={draft.note} onChange={e => set('note', e.target.value)} />
      </label>
      <fieldset className="full groups">
        <legend className="eyebrow">Qui verra cette envie ? (à choisir)</legend>
        <div className="row">
          <label className={'gpick private' + (draft.privateOnly ? ' on' : '')} htmlFor={id + 'private'}>
            <input type="checkbox" id={id + 'private'} checked={draft.privateOnly} onChange={e => togglePrivate(e.target.checked)} />
            Seulement moi pour l’instant
          </label>
          {d.myGroups.map(g => {
            const on = draft.groups.includes(g.id);
            return (
              <label key={g.id} className={'gpick' + (on ? ' on' : '')} htmlFor={id + 'g' + g.id}>
                <input type="checkbox" id={id + 'g' + g.id} checked={on} onChange={e => toggleGroup(g.id, e.target.checked)} />
                {g.name}
              </label>
            );
          })}
        </div>
        {d.myGroups.length === 0 && <p className="note">Tu n’as pas encore de groupe : garde-la pour toi, tu pourras la partager plus tard avec « Modifier ».</p>}
      </fieldset>
      <div className="row full">
        <button className="btn" type="submit" disabled={busy}>{submitLabel}</button>
        {onCancel && <button className="btn ghost" type="button" onClick={onCancel}>Annuler</button>}
      </div>
    </form>
  );
}
