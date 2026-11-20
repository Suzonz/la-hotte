'use client';

import { useId, useState } from 'react';
import { useHotte } from '@/lib/hotte';
import { WANT_LABEL, safeUrl, wantStars } from '@/lib/format';
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

  // Errors show under the field that needs fixing, once the form was sent,
  // and go away as soon as the field is fixed.
  const [tried, setTried] = useState(false);
  const problems = {
    title: !draft.title.trim() ? 'Écris le nom du cadeau' : '',
    link: draft.link.trim() && !safeUrl(draft.link) ? 'Le lien doit commencer par http:// ou https://' : '',
    groups: !draft.privateOnly && !draft.groups.some(g => d.myGroups.some(x => x.id === g)) ? 'Choisis qui verra cette envie' : '',
  };
  const err = tried ? problems : { title: '', link: '', groups: '' };
  const submit = () => {
    const first = (['title', 'link', 'groups'] as const).find(k => problems[k]);
    if (!first) { setTried(false); onSubmit(); return; }
    setTried(true);
    const el = document.getElementById(id + first);
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el?.focus({ preventScroll: true });
  };

  return (
    <form className="grid" noValidate onSubmit={e => { e.preventDefault(); submit(); }}>
      <label className={'full' + (err.title ? ' invalid' : '')} htmlFor={id + 'title'}>Le cadeau
        <input id={id + 'title'} value={draft.title} maxLength={120} placeholder="Ex. Casque audio sans fil"
          aria-invalid={!!err.title} onChange={e => set('title', e.target.value)} />
        {err.title && <span className="field-error">{err.title}</span>}
      </label>
      <label className={err.link ? 'invalid' : ''} htmlFor={id + 'link'}>Lien (facultatif)
        <input id={id + 'link'} value={draft.link} inputMode="url" placeholder="https://…"
          aria-invalid={!!err.link} onChange={e => set('link', e.target.value)} />
        {err.link && <span className="field-error">{err.link}</span>}
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
      <fieldset className={'full groups' + (err.groups ? ' invalid' : '')}>
        <legend className="eyebrow">Qui verra cette envie ?</legend>
        <div className="row" id={id + 'groups'} tabIndex={-1} role="group" aria-invalid={!!err.groups}>
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
        {err.groups && <span className="field-error" role="alert">{err.groups}</span>}
        {d.myGroups.length === 0 && <p className="note">Tu n’as pas encore de groupe : garde-la pour toi, tu pourras la partager plus tard avec « Modifier ».</p>}
      </fieldset>
      <div className="row full">
        <button className="btn" type="submit" disabled={busy}>{submitLabel}</button>
        {onCancel && <button className="btn ghost" type="button" onClick={onCancel}>Annuler</button>}
      </div>
    </form>
  );
}
