'use client';

import { useState } from 'react';
import { useHotte } from '@/lib/hotte';
import type { Group, SantaMode } from '@/lib/types';
import { SantaCard } from './SantaCard';
import { SantaEditor } from './SantaEditor';
import { MODES } from './shared';

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

