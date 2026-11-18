'use client';

import { useEffect, useState } from 'react';
import { useHotte } from '@/lib/hotte';
import { byName, plural } from '@/lib/format';
import type { Group } from '@/lib/types';

/** « Mes groupes », always at the top of my page. */
export function GroupsPanel({ openGroup }: { openGroup?: string | null }) {
  const { d, actions, run } = useHotte();
  const [open, setOpen] = useState<string | null>(openGroup ?? null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');

  useEffect(() => { if (openGroup) setOpen(openGroup); }, [openGroup]);
  const current = d.myGroups.find(g => g.id === open) ?? null;

  const create = () => {
    if (!newName.trim()) return;
    let id = '';
    run(async () => { id = await actions.createGroup(newName); }, `Groupe « ${newName.trim()} » créé : invite des personnes avec son lien`)
      .then(r => { if (r.ok) { setCreating(false); setNewName(''); setOpen(id); } });
  };

  return (
    <section className="panel groups-panel">
      <div className="listhead">
        <h2>Mes groupes</h2>
        <button className="btn sm" onClick={() => { setCreating(c => !c); setNewName(''); }}>+ Nouveau groupe</button>
      </div>

      {creating && (
        <form className="row" onSubmit={e => { e.preventDefault(); create(); }}>
          <input aria-label="Nom du nouveau groupe" value={newName} maxLength={50} autoFocus style={{ maxWidth: 280 }}
            placeholder="Nom du groupe, ex. Collègues" onChange={e => setNewName(e.target.value)} />
          <button className="btn sm" type="submit">Créer</button>
          <button className="btn ghost sm" type="button" onClick={() => setCreating(false)}>Annuler</button>
        </form>
      )}

      {d.myGroups.length === 0 ? (
        <p className="note">Tu n’es dans aucun groupe : personne ne voit tes envies. Crée ton premier groupe (par exemple « Famille ») avec le bouton ci-dessus, ou ouvre un lien d’invitation qu’on t’a envoyé.</p>
      ) : (
        <>
          <div className="row">
            {d.myGroups.map(g => (
              <button key={g.id} className="gchip" aria-expanded={open === g.id} onClick={() => setOpen(open === g.id ? null : g.id)}>
                <b>{g.name}</b> · {plural(d.membersOf(g.id).length, 'personne')}
              </button>
            ))}
          </div>
          {current
            ? <GroupDetail key={current.id} group={current} onClosed={() => setOpen(null)} />
            : <p className="note">Clique sur un groupe pour voir ses membres, copier son lien d’invitation ou ajouter quelqu’un.</p>}
        </>
      )}
    </section>
  );
}

function GroupDetail({ group: g, onClosed }: { group: Group; onClosed: () => void }) {
  const { d, actions, run, toast } = useHotte();
  const isCreator = g.created_by === d.me;
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(g.name);
  const [picked, setPicked] = useState<string[]>([]);
  const [confirm, setConfirm] = useState<null | 'leave' | 'delete' | 'relink' | { remove: string }>(null);
  const link = typeof window === 'undefined' ? '' : `${window.location.origin}/rejoindre/${g.invite_code}`;
  const linkId = 'link-' + g.id;

  const members = d.membersOf(g.id);
  const nameOf = (uid: string) => (uid === d.me ? 'Toi' : d.personByUser.get(uid)?.name ?? 'Quelqu’un');
  const sorted = [...members].sort((a, b) => (a.user_id === d.me ? -1 : b.user_id === d.me ? 1 : byName(nameOf(a.user_id), nameOf(b.user_id))));
  const canRemove = (uid: string, addedBy: string | null) => uid !== d.me && uid !== g.created_by && (isCreator || addedBy === d.me);
  // People I already share another group with, not yet in this one.
  const candidates = d.others.filter(p => p.user_id && !d.isMember(p.user_id, g.id));

  const copy = async () => {
    try { await navigator.clipboard.writeText(link); toast('Lien copié : envoie-le aux personnes à inviter'); }
    catch {
      const el = document.getElementById(linkId) as HTMLInputElement | null;
      el?.focus(); el?.select();
      toast('Le lien est sélectionné : copie-le avec Ctrl+C');
    }
  };

  return (
    <div className="detail">
      <div className="listhead">
        {renaming ? (
          <form className="row" onSubmit={e => { e.preventDefault(); run(() => actions.renameGroup(g.id, name), 'Groupe renommé').then(r => r.ok && setRenaming(false)); }}>
            <input aria-label="Nom du groupe" value={name} maxLength={50} style={{ maxWidth: 240 }} onChange={e => setName(e.target.value)} autoFocus />
            <button className="btn sm" type="submit">Enregistrer</button>
            <button className="btn ghost sm" type="button" onClick={() => setRenaming(false)}>Annuler</button>
          </form>
        ) : (
          <div className="stack">
            <h3 className="ititle">{g.name}</h3>
            <span className="who">Créé par {isCreator ? 'toi' : nameOf(g.created_by)}</span>
          </div>
        )}
        {isCreator && !renaming && <button className="btn ghost sm" onClick={() => { setName(g.name); setRenaming(true); }}>Renommer</button>}
      </div>

      <div className="stack" style={{ alignItems: 'stretch' }}>
        <span className="eyebrow">Membres ({members.length})</span>
        <ul className="members">
          {sorted.map(m => (
            <li key={m.user_id}>
              <span>{nameOf(m.user_id)}{m.user_id === g.created_by && <span className="who"> · créateur</span>}</span>
              {canRemove(m.user_id, m.added_by) && (
                typeof confirm === 'object' && confirm?.remove === m.user_id ? (
                  <span className="row">
                    <span className="who">Retirer du groupe ?</span>
                    <button className="btn danger sm" onClick={() => run(() => actions.removeMember(g.id, m.user_id), `${nameOf(m.user_id)} a été retiré(e) du groupe`).then(() => setConfirm(null))}>Retirer</button>
                    <button className="btn ghost sm" onClick={() => setConfirm(null)}>Annuler</button>
                  </span>
                ) : <button className="btn ghost sm" onClick={() => setConfirm({ remove: m.user_id })}>Retirer</button>
              )}
            </li>
          ))}
        </ul>
        <p className="note">{isCreator
          ? 'Tu peux retirer n’importe quel membre, puisque tu as créé ce groupe.'
          : `Tu peux retirer les personnes que tu as ajoutées toi-même. Pour les autres, demande à ${nameOf(g.created_by)}.`}</p>
      </div>

      <div className="stack" style={{ alignItems: 'stretch' }}>
        <label htmlFor={linkId}>Lien d’invitation du groupe</label>
        <div className="row">
          <input id={linkId} value={link} readOnly style={{ flex: '1 1 220px' }} onFocus={e => e.target.select()} />
          <button className="btn sm" type="button" onClick={copy}>Copier le lien</button>
        </div>
        <p className="note">Envoie ce lien par message ou par e-mail. En l’ouvrant, la personne se connecte avec son adresse e-mail et rejoint le groupe.</p>
        {isCreator && (confirm === 'relink' ? (
          <div className="row">
            <span className="who">Changer le lien ? L’ancien ne marchera plus (les membres actuels restent).</span>
            <button className="btn danger sm" onClick={() => run(() => actions.regenerateInvite(g.id), 'Nouveau lien créé').then(() => setConfirm(null))}>Changer</button>
            <button className="btn ghost sm" onClick={() => setConfirm(null)}>Annuler</button>
          </div>
        ) : <div><button className="linkish" onClick={() => setConfirm('relink')}>Changer le lien d’invitation</button></div>)}
      </div>

      <div className="stack" style={{ alignItems: 'stretch' }}>
        <span className="eyebrow">Ajouter quelqu’un que tu connais déjà</span>
        {candidates.length ? (
          <form className="stack" onSubmit={e => {
            e.preventDefault();
            const ids = picked;
            run(() => actions.addMembers(g.id, ids), `${ids.map(u => nameOf(u)).join(', ')} ajouté(e)s à « ${g.name} »`).then(r => r.ok && setPicked([]));
          }}>
            <div className="row">
              {candidates.map(p => {
                const uid = p.user_id as string, on = picked.includes(uid);
                return (
                  <label key={uid} className={'gpick' + (on ? ' on' : '')}>
                    <input type="checkbox" checked={on} onChange={e => setPicked(e.target.checked ? [...picked, uid] : picked.filter(x => x !== uid))} />
                    {p.name}
                  </label>
                );
              })}
            </div>
            <button className="btn alt sm" type="submit" disabled={!picked.length}>Ajouter au groupe</button>
          </form>
        ) : <p className="note">Tu peux ajouter ici les personnes de tes autres groupes. Pour quelqu’un de nouveau, envoie le lien.</p>}
      </div>

      <div className="row">
        {confirm === 'leave' ? (
          <>
            <span className="who">Quitter « {g.name} » ? Ses membres ne verront plus tes envies rangées dans ce groupe.</span>
            <button className="btn danger sm" onClick={() => run(() => actions.leaveGroup(g.id), `Tu as quitté « ${g.name} »`).then(r => r.ok && onClosed())}>Quitter</button>
            <button className="btn ghost sm" onClick={() => setConfirm(null)}>Rester</button>
          </>
        ) : confirm === 'delete' ? (
          <>
            <span className="who">Supprimer « {g.name} » pour tout le monde ? Les envies rangées seulement dans ce groupe ne seront plus visibles.</span>
            <button className="btn danger sm" onClick={() => run(() => actions.deleteGroup(g.id), 'Groupe supprimé').then(r => r.ok && onClosed())}>Supprimer</button>
            <button className="btn ghost sm" onClick={() => setConfirm(null)}>Garder</button>
          </>
        ) : (
          <>
            <button className="btn ghost sm" onClick={() => setConfirm('leave')}>Quitter le groupe</button>
            {isCreator && <button className="btn ghost sm" onClick={() => setConfirm('delete')}>Supprimer le groupe</button>}
          </>
        )}
      </div>
    </div>
  );
}
