'use client';

import { useEffect, useRef, useState } from 'react';
import { useHotte, type SantaForm } from '@/lib/hotte';
import { byName, eur } from '@/lib/format';
import type { Group, Person, Santa, SantaMode } from '@/lib/types';

// Design rule for this box: one thing stands out per card — what *I* have to do
// or know. Everything else is plain grey text; organiser actions live under ⚙️.

const dayFmt = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long' });
export const frDay = (isoOrDate: string) => dayFmt.format(new Date(isoOrDate.length === 10 ? isoOrDate + 'T00:00:00' : isoOrDate));
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const MODES: Record<SantaMode, { icon: string; title: string; text: string }> = {
  draw: { icon: '🎲', title: 'Faire le tirage avec La Hotte', text: 'La Hotte tire au sort. Personne, pas même toi, ne sait qui a qui avant la révélation.' },
  manual: { icon: '✍️', title: 'Le tirage est déjà fait', text: 'Vous avez tiré au sort ailleurs (papiers, autre site). Chacun indique ici la personne qu’il a tirée.' },
};

const GIFT_STATE = {
  none: '⏳ Pas encore de cadeau choisi',
  progress: '🛍️ Cadeau en cours',
  done: '✅ Cadeau complet',
} as const;

function defaultDates() {
  const now = new Date();
  let year = now.getFullYear();
  if (now > new Date(year, 11, 25)) year += 1;
  return { eventDate: `${year}-12-25`, revealDate: `${year}-12-26`, year };
}

/** Everyone who can take part: the group's members and their children. */
function useCandidates(group: Group) {
  const { d, data } = useHotte();
  const memberIds = d.membersOf(group.id).map(m => m.user_id);
  return data.persons
    .filter(p => (p.user_id && memberIds.includes(p.user_id)) || (p.manager_id && memberIds.includes(p.manager_id)))
    .sort((a, b) => byName(a.name, b.name));
}

// ---------------------------------------------------------------- the box at the bottom of a group

export function SantaSection({ group, onOpenPerson }: { group: Group; onOpenPerson: (personId: string) => void }) {
  const { d } = useHotte();
  const santas = d.santasOf(group.id);
  const [choosing, setChoosing] = useState(false);
  const [mode, setMode] = useState<SantaMode | null>(null);
  const showChoice = santas.length === 0 || choosing;
  const close = () => { setChoosing(false); setMode(null); };

  return (
    <section className="panel">
      <div className="listhead" style={{ alignItems: 'center' }}>
        <h2>🎅 Secret Santa</h2>
        {!showChoice && <button className="linkish" onClick={() => setChoosing(true)}>+ Créer un autre Secret Santa</button>}
      </div>

      {santas.map(s => <SantaCard key={s.id} santa={s} group={group} onOpenPerson={onOpenPerson} />)}

      {showChoice ? (
        <div className="stack" style={{ alignItems: 'stretch' }}>
          {santas.length === 0 && <p className="note">Chacun offre un cadeau à une personne tirée au sort, sans savoir qui lui offre le sien. Tout est dévoilé le lendemain de l’échange.</p>}
          <div className="mode-choice">
            {(Object.keys(MODES) as SantaMode[]).map(m => (
              <button key={m} type="button" className={'mode-card' + (mode === m ? ' on' : '')} aria-pressed={mode === m} onClick={() => setMode(m)}>
                <span className="big" aria-hidden="true">{MODES[m].icon}</span>
                <b>{MODES[m].title}</b>
                <span className="who">{MODES[m].text}</span>
              </button>
            ))}
          </div>
          {mode && <SantaEditor key={mode} group={group} mode={mode} onDone={close} />}
          {santas.length > 0 && !mode && <div><button className="linkish" onClick={close}>Annuler</button></div>}
        </div>
      ) : null}
    </section>
  );
}

// ---------------------------------------------------------------- create / edit

function SantaEditor({ group, mode, santa, onDone }: { group: Group; mode: SantaMode; santa?: Santa; onDone: () => void }) {
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
    const parent = p.manager_id ? d.personByUser.get(p.manager_id) : null;
    return (
      <label key={p.id} className={'gpick' + (on ? ' on' : '')}>
        <input type="checkbox" checked={on}
          onChange={e => set('participants', e.target.checked ? [...form.participants, p.id] : form.participants.filter(x => x !== p.id))} />
        {p.user_id === d.me ? `${p.name} (toi)` : p.name}
        {parent && <span className="who">({parent.user_id === d.me ? 'ton enfant' : `enfant de ${parent.name}`})</span>}
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
function ExclusionsEditor({ people, value, onChange }: { people: Person[]; value: [string, string][]; onChange: (v: [string, string][]) => void }) {
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

// ---------------------------------------------------------------- one Secret Santa

function SantaCard({ santa: s, group, onOpenPerson }: { santa: Santa; group: Group; onOpenPerson: (personId: string) => void }) {
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
function ParticipantsAfterDraw({ santa: s, group, participants }: { santa: Santa; group: Group; participants: Person[] }) {
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

