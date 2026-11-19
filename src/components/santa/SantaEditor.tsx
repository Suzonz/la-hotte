'use client';

import { useState } from 'react';
import { useHotte, type SantaForm } from '@/lib/hotte';
import type { Group, Person, Santa, SantaMode } from '@/lib/types';
import { ExclusionsEditor } from './SantaParticipants';
import { defaultDates, useCandidates, ymd } from './shared';

// ---------------------------------------------------------------- create / edit

export function SantaEditor({ group, mode, santa, onDone }: { group: Group; mode: SantaMode; santa?: Santa; onDone: () => void }) {
  const { d, actions, run } = useHotte();
  const candidates = useCandidates(group);
  const defaults = defaultDates();
  const locked = santa ? d.santaProgressOf(santa.id).drawn > 0 : false;   // participants are fixed once names exist
  // Names must differ within a group (case and spaces ignored).
  const norm = (n: string) => n.trim().toLocaleLowerCase('fr');
  const takenNames = d.santasOf(group.id).filter(x => x.id !== santa?.id).map(x => norm(x.name));
  const freeName = (base: string) => {
    if (!takenNames.includes(norm(base))) return base;
    for (let i = 2; ; i++) if (!takenNames.includes(norm(`${base} (${i})`))) return `${base} (${i})`;
  };
  const [form, setForm] = useState<SantaForm>(() => santa
    ? { name: santa.name, mode, budget: santa.budget != null ? String(santa.budget) : '', eventDate: santa.event_date, revealDate: ymd(new Date(santa.reveal_at)), participants: d.participantsOf(santa.id) }
    // Adults are in by default; children usually don't draw anyone, so they start unticked.
    : { name: freeName(`Secret Santa ${group.name} ${defaults.year}`), mode, budget: '', eventDate: defaults.eventDate, revealDate: defaults.revealDate, participants: candidates.filter(p => p.user_id).map(p => p.id) });
  const duplicate = takenNames.includes(norm(form.name));
  const [exclusions, setExclusions] = useState<[string, string][]>([]);
  const set = <K extends keyof SantaForm>(k: K, v: SantaForm[K]) => setForm(f => ({ ...f, [k]: v }));
  const tooFew = form.participants.length < 3;
  const adults = candidates.filter(p => p.user_id);
  const kids = candidates.filter(p => !p.user_id);
  const chosen = candidates.filter(p => form.participants.includes(p.id));
  const creatingDraw = !santa && mode === 'draw';

  const pick = (p: Person) => {
    const on = form.participants.includes(p.id);
    const parents = !p.user_id ? d.parentNames(p) : '';
    return (
      <label key={p.id} className={'gpick' + (on ? ' on' : '')}>
        <input type="checkbox" checked={on}
          onChange={e => set('participants', e.target.checked ? [...form.participants, p.id] : form.participants.filter(x => x !== p.id))} />
        {p.user_id === d.me ? `${p.name} (toi)` : p.name}
        {parents && <span className="who">(enfant de {parents})</span>}
      </label>
    );
  };

  const save = () => run(
    async () => {
      if (santa) { await actions.updateSanta(santa.id, form); return null; }
      return (await actions.createSanta(group.id, form, exclusions)).drawError;
    },
    drawError => santa ? 'Modifié'
      : drawError ? `Secret Santa créé, mais le tirage n’a pas pu se faire : ${drawError}`
      : mode === 'draw' ? 'Tirage fait 🎉 Chacun voit maintenant sa personne.'
      : 'C’est prêt : chacun peut indiquer la personne qu’il a tirée',
  ).then(r => r.ok && onDone());

  return (
    <form className="grid detail-plain" onSubmit={e => { e.preventDefault(); save(); }}>
      <label className="full">Nom
        <input value={form.name} maxLength={60} onChange={e => set('name', e.target.value)} aria-invalid={duplicate} />
        {duplicate && <span className="warn">Un autre Secret Santa de ce groupe porte déjà ce nom : choisis-en un autre.</span>}
      </label>
      <label>Budget par cadeau (€, facultatif)
        <input value={form.budget} inputMode="decimal" placeholder="Ex. 30" onChange={e => set('budget', e.target.value)} />
      </label>
      <label>Date de l’échange
        <input type="date" value={form.eventDate} onChange={e => set('eventDate', e.target.value)} />
      </label>
      <label className="full">Révélation : tout le monde voit qui offrait à qui à partir du
        <input type="date" value={form.revealDate} min={form.eventDate} onChange={e => set('revealDate', e.target.value)} style={{ maxWidth: 200 }} />
      </label>

      {!locked && (
        <fieldset className="full groups">
          <legend className="eyebrow">Participants ({form.participants.length}) · décoche ceux qui ne participent pas</legend>
          <div className="row">{adults.map(pick)}</div>
          {kids.length > 0 && (
            <>
              <span className="eyebrow" style={{ marginTop: 6 }}>Enfants · à cocher seulement s’ils participent</span>
              <div className="row">{kids.map(pick)}</div>
            </>
          )}
          {tooFew && <p className="warn">Il faut au moins 3 participants.</p>}
        </fieldset>
      )}

      {creatingDraw && chosen.length >= 3 && (
        <details className="full">
          <summary className="linkish" style={{ listStyle: 'none' }}>Exclusions (facultatif){exclusions.length ? ` · ${exclusions.length}` : ''}</summary>
          <ExclusionsEditor people={chosen} value={exclusions} onChange={setExclusions} />
        </details>
      )}

      <div className="row full">
        <button className="btn" type="submit" disabled={duplicate || !form.name.trim() || (!locked && tooFew)}>
          {santa ? 'Enregistrer' : mode === 'draw' ? '🎲 Tirer au sort' : 'Valider'}
        </button>
        <button className="btn ghost" type="button" onClick={onDone}>Annuler</button>
      </div>
    </form>
  );
}

/** Pairs that must not draw each other (a couple…), chosen before the draw. */
