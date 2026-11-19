'use client';

import { useEffect, useRef, useState } from 'react';
import { useHotte } from '@/lib/hotte';
import { byName, eur } from '@/lib/format';
import type { Group, Person, Santa } from '@/lib/types';
import { SantaEditor } from './SantaEditor';
import { ParticipantsAfterDraw, ExclusionsEditor } from './SantaParticipants';
import { frDay, GIFT_STATE } from './shared';

// ---------------------------------------------------------------- one Secret Santa

export function SantaCard({ santa: s, group, onOpenPerson }: { santa: Santa; group: Group; onOpenPerson: (personId: string) => void }) {
  const { d, actions, run } = useHotte();
  const [editing, setEditing] = useState(false);
  const [confirm, setConfirm] = useState<null | 'delete' | 'reset'>(null);
  const participants = d.participantsOf(s.id).map(id => d.personById.get(id)).filter((p): p is Person => !!p).sort((a, b) => byName(a.name, b.name));
  const progress = d.santaProgressOf(s.id);
  const drawn = progress.drawn > 0;
  const revealed = d.isRevealed(s);
  const isOrganizer = s.created_by === d.me;
  const pairs = d.pairsOf(s.id);
  const nameOf = (pid: string) => d.personById.get(pid)?.name ?? 'quelqu’un';
  const mine = participants.filter(p => d.manages(p));   // me and my children

  const menu = isOrganizer ? [
    ...(!revealed && s.mode ? [{ label: 'Modifier', onSelect: () => setEditing(true) }] : []),
    ...(drawn && !revealed ? [{ label: s.mode === 'draw' ? 'Recommencer le tirage' : 'Effacer les saisies', onSelect: () => setConfirm('reset') }] : []),
    { label: 'Supprimer', onSelect: () => setConfirm('delete') },
  ] : [];

  return (
    <article className="santa-card">
      <div className="listhead">
        <div className="stack" style={{ gap: 2 }}>
          <h3 className="ititle">{s.name}</h3>
          <span className="who">
            {frDay(s.event_date)} · {participants.map(p => p.name).join(', ')}{s.budget != null && ` · ${eur(s.budget)}`}
          </span>
        </div>
        {menu.length > 0 && <GearMenu items={menu} />}
      </div>

      {confirm && (
        <div className="row">
          <span className="who">{confirm === 'delete'
            ? `Supprimer « ${s.name} » pour tout le monde ?`
            : s.mode === 'draw' ? 'Effacer le tirage ? Chacun recevra une nouvelle personne quand tu le relanceras.' : 'Effacer toutes les saisies ? Chacun devra indiquer à nouveau sa personne.'}</span>
          <button className="btn danger sm" onClick={() => run(
            () => (confirm === 'delete' ? actions.deleteSanta(s.id) : actions.resetSanta(s.id)),
            confirm === 'delete' ? 'Secret Santa supprimé' : 'C’est effacé',
          ).then(() => setConfirm(null))}>{confirm === 'delete' ? 'Supprimer' : 'Effacer'}</button>
          <button className="btn ghost sm" onClick={() => setConfirm(null)}>Annuler</button>
        </div>
      )}

      {!s.mode ? (
        <p className="note">Créé avec une ancienne version de La Hotte. {isOrganizer ? 'Supprime-le (⚙️) et recrée-le.' : 'L’organisateur va le recréer.'}</p>
      ) : revealed ? (
        <div>
          <span className="eyebrow">Qui offrait à qui</span>
          {participants.map(p => {
            const pair = pairs.find(x => x.giver_id === p.id);
            return <div key={p.id} className="gline"><span className="t"><b>{p.name}</b> → {pair ? nameOf(pair.receiver_id) : <span className="warn">personne</span>}</span></div>;
          })}
        </div>
      ) : (
        <>
          {mine.map(p => <MyDraw key={p.id} santa={s} giver={p} participants={participants} onOpenPerson={onOpenPerson} />)}
          {isOrganizer && <OrganizerLine santa={s} participants={participants} />}
          {!mine.length && !isOrganizer && <p className="note">Tu ne participes pas à celui-ci. Tout sera révélé le {frDay(s.reveal_at)}.</p>}
        </>
      )}

      {isOrganizer && editing && s.mode && (
        <>
          <SantaEditor group={group} mode={s.mode} santa={s} onDone={() => setEditing(false)} />
          {drawn && <ParticipantsAfterDraw santa={s} group={group} participants={participants} />}
        </>
      )}
    </article>
  );
}

function GearMenu({ items }: { items: { label: string; onSelect: () => void }[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);
  return (
    <div className="menu-tab" ref={ref}>
      <button className="icon-btn" aria-label="Gérer ce Secret Santa" title="Gérer" aria-expanded={open} onClick={() => setOpen(o => !o)}>⚙️</button>
      {open && (
        <ul className="menu menu-right" role="menu">
          {items.map(i => <li key={i.label} role="none"><button role="menuitem" onClick={() => { setOpen(false); i.onSelect(); }}>{i.label}</button></li>)}
        </ul>
      )}
    </div>
  );
}

/** The one line that matters for me (or my child): whom I give to, or what to do. */
function MyDraw({ santa: s, giver, participants, onOpenPerson }: { santa: Santa; giver: Person; participants: Person[]; onOpenPerson: (id: string) => void }) {
  const { d, actions, run } = useHotte();
  const [correcting, setCorrecting] = useState(false);
  const [pick, setPick] = useState('');
  const pair = d.pairsOf(s.id).find(p => p.giver_id === giver.id);
  const isMe = giver.user_id === d.me;
  const receiver = pair ? d.personById.get(pair.receiver_id) : null;
  const giftState = d.santaGiftState(s.id, giver.id);

  if (pair && !correcting) {
    return (
      <div className="draw-line">
        <span className="row" style={{ gap: 4 }}>
          {isMe ? 'Tu offres à' : `${giver.name} offre à`} <b>{receiver?.name ?? 'quelqu’un'}</b>
          {s.mode === 'manual' && pair.entered_by === d.me && (
            <button className="icon-btn" title="Corriger" aria-label="Corriger la personne tirée" onClick={() => { setPick(pair.receiver_id); setCorrecting(true); }}>✏️</button>
          )}
        </span>
        {receiver && <button className="btn sm" onClick={() => onOpenPerson(receiver.id)}>Voir ses envies</button>}
        <span className={'state full-line state-' + giftState}>{GIFT_STATE[giftState]}</span>
        {pair.changed_at && <span className="warn full-line">{isMe ? 'Ton tirage a changé' : 'Ce tirage a changé'} : une personne ne participe plus.</span>}
      </div>
    );
  }

  // Draw not done yet: the organiser's « Tirer au sort » button says it all.
  if (s.mode === 'draw') {
    return s.created_by === d.me ? null : <p className="note">Le tirage n’a pas encore eu lieu.</p>;
  }

  return (
    <form className="stack" style={{ alignItems: 'stretch', gap: 4 }}
      onSubmit={e => { e.preventDefault(); if (pick) run(() => actions.enterPair(s.id, giver.id, pick), 'C’est noté').then(r => r.ok && setCorrecting(false)); }}>
      <div className="row">
        <b>{isMe ? 'Qui as-tu tiré ?' : `Qui ${giver.name} a-t-il tiré ?`}</b>
        <select value={pick} onChange={e => setPick(e.target.value)} className="select" aria-label="Personne tirée">
          <option value="">— choisir —</option>
          {participants.filter(p => p.id !== giver.id).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <button className="btn sm" type="submit" disabled={!pick}>Enregistrer</button>
        {correcting && <button className="btn ghost sm" type="button" onClick={() => setCorrecting(false)}>Annuler</button>}
      </div>
      <span className="who">Personne d’autre ne le verra avant le {frDay(s.reveal_at)}.</span>
    </form>
  );
}

/** The organiser's single line: launch the draw, or who still has to say whom they drew. */
function OrganizerLine({ santa: s, participants }: { santa: Santa; participants: Person[] }) {
  const { d, actions, run } = useHotte();
  const [showExclusions, setShowExclusions] = useState(false);
  const drawn = d.santaProgressOf(s.id).drawn > 0;

  if (s.mode === 'manual') {
    const missing = d.missingOf(s.id).map(id => d.personById.get(id)?.name ?? '?').sort(byName);
    return missing.length ? <p className="note">Il manque encore : {missing.join(', ')}.</p> : null;
  }
  if (drawn) return null;

  const saved = d.exclusionsOf(s.id).map(e => [e.a, e.b] as [string, string]);
  return (
    <div className="stack" style={{ alignItems: 'stretch' }}>
      <div className="row">
        <button className="btn" disabled={participants.length < 3} onClick={() => run(() => actions.drawSanta(s.id), 'Tirage fait 🎉')}>🎲 Tirer au sort</button>
        <button className="linkish" onClick={() => setShowExclusions(x => !x)}>Exclusions{saved.length ? ` · ${saved.length}` : ''}</button>
        {participants.length < 3 && <span className="who">Il faut au moins 3 participants.</span>}
      </div>
      {showExclusions && (
        <ExclusionsEditor people={participants} value={saved} onChange={async next => {
          const added = next.filter(([a, b]) => !saved.some(([x, y]) => x === a && y === b));
          const removed = saved.filter(([a, b]) => !next.some(([x, y]) => x === a && y === b));
          await run(async () => {
            for (const [a, b] of added) await actions.addExclusion(s.id, a, b);
            for (const [a, b] of removed) await actions.removeExclusion(s.id, a, b);
          });
        }} />
      )}
    </div>
  );
}

/** After the draw: take someone out (chain is rewired), or add someone (the draw is done again). */
