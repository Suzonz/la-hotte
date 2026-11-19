'use client';

import { useState } from 'react';
import { useHotte } from '@/lib/hotte';
import type { Group, Person, Santa, SantaMode } from '@/lib/types';
import { useCandidates } from './shared';

export function ExclusionsEditor({ people, value, onChange }: { people: Person[]; value: [string, string][]; onChange: (v: [string, string][]) => void }) {
  const [a, setA] = useState('');
  const [b, setB] = useState('');
  const nameOf = (id: string) => people.find(p => p.id === id)?.name ?? '?';
  const options = (exclude?: string) => people.filter(p => p.id !== exclude).map(p => <option key={p.id} value={p.id}>{p.name}</option>);
  return (
    <div className="stack" style={{ alignItems: 'stretch', marginTop: 8 }}>
      <p className="note">Ces personnes ne se tireront pas entre elles : un couple, ou deux personnes qui se sont offert un cadeau l’an dernier.</p>
      {value.map(([x, y]) => (
        <div key={x + y} className="gline">
          <span className="t">{nameOf(x)} ✕ {nameOf(y)}</span>
          <button type="button" className="btn ghost sm" onClick={() => onChange(value.filter(([p, q]) => !(p === x && q === y)))}>Retirer</button>
        </div>
      ))}
      <div className="row">
        <select className="select" value={a} onChange={e => setA(e.target.value)} aria-label="Première personne"><option value="">—</option>{options()}</select>
        <span>✕</span>
        <select className="select" value={b} onChange={e => setB(e.target.value)} aria-label="Deuxième personne"><option value="">—</option>{options(a)}</select>
        <button type="button" className="btn alt sm" disabled={!a || !b} onClick={() => { onChange([...value, [a, b]]); setA(''); setB(''); }}>Ajouter</button>
      </div>
    </div>
  );
}

export function ParticipantsAfterDraw({ santa: s, group, participants }: { santa: Santa; group: Group; participants: Person[] }) {
  const { actions, run } = useHotte();
  const candidates = useCandidates(group).filter(p => !participants.some(x => x.id === p.id));
  const [removing, setRemoving] = useState<string | null>(null);
  const [adding, setAdding] = useState<string[]>([]);
  const [confirmAdd, setConfirmAdd] = useState(false);
  const mode = s.mode as SantaMode;

  return (
    <div className="stack" style={{ alignItems: 'stretch' }}>
      <span className="eyebrow">Participants ({participants.length})</span>
      <ul className="members">
        {participants.map(p => (
          <li key={p.id}>
            <span>{p.name}</span>
            {removing === p.id ? (
              <span className="row">
                <span className="who">La personne qui offrait à {p.name} recevra quelqu’un d’autre et sera prévenue.</span>
                <button className="btn danger sm" onClick={() => run(() => actions.removeParticipant(s.id, p.id),
                  n => `${p.name} ne participe plus. ${n > 1 ? `${n} personnes ont` : 'Une personne a'} un nouveau tirage.`).then(() => setRemoving(null))}>Retirer</button>
                <button className="btn ghost sm" onClick={() => setRemoving(null)}>Annuler</button>
              </span>
            ) : <button className="linkish" onClick={() => setRemoving(p.id)} disabled={participants.length <= 3}>Retirer</button>}
          </li>
        ))}
      </ul>
      {participants.length <= 3 && <p className="note">Avec 3 participants, on ne peut plus retirer personne.</p>}

      {candidates.length > 0 && (
        <>
          <span className="eyebrow">Ajouter quelqu’un</span>
          <div className="row">
            {candidates.map(p => {
              const on = adding.includes(p.id);
              return (
                <label key={p.id} className={'gpick' + (on ? ' on' : '')}>
                  <input type="checkbox" checked={on} onChange={e => { setConfirmAdd(false); setAdding(e.target.checked ? [...adding, p.id] : adding.filter(x => x !== p.id)); }} />
                  {p.name}
                </label>
              );
            })}
          </div>
          {adding.length > 0 && (confirmAdd ? (
            <div className="row">
              <span className="who">{mode === 'draw' ? 'Tout le monde recevra une nouvelle personne.' : 'Chacun devra tirer un nouveau papier et l’indiquer ici.'}</span>
              <button className="btn sm" onClick={() => run(() => actions.redrawWith(s.id, adding, mode),
                mode === 'draw' ? 'Nouveau tirage fait 🎉' : 'C’est fait : chacun doit indiquer sa nouvelle personne').then(r => { if (r.ok) { setAdding([]); setConfirmAdd(false); } })}>Confirmer</button>
              <button className="btn ghost sm" onClick={() => setConfirmAdd(false)}>Annuler</button>
            </div>
          ) : (
            <div><button className="btn alt sm" onClick={() => setConfirmAdd(true)}>{mode === 'draw' ? 'Refaire le tirage avec' : 'Tout recommencer avec'} {adding.length} personne{adding.length > 1 ? 's' : ''} de plus</button></div>
          ))}
        </>
      )}
    </div>
  );
}

