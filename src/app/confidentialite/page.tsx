import { Logo } from '@/components/Header';

export const metadata = { title: 'Confidentialité · La Hotte' };

// Who to write to about personal data. Set NEXT_PUBLIC_CONTACT_EMAIL when the site goes online.
const CONTACT = process.env.NEXT_PUBLIC_CONTACT_EMAIL;

export default function PrivacyPage() {
  return (
    <main className="wrap" style={{ maxWidth: 680 }}>
      <a className="brand" href="/" style={{ marginBlock: 20 }}><Logo />La Hotte</a>
      <h1>Confidentialité</h1>
      <p className="sub">La Hotte est une petite appli pour partager des listes de cadeaux entre proches. Voici, simplement, ce qu’elle garde et pourquoi.</p>

      <section className="prose">
        <h2>Ce qui est enregistré</h2>
        <ul>
          <li><b>Ton adresse e-mail</b>, pour t’envoyer ton lien de connexion. Elle n’est montrée à personne.</li>
          <li><b>Ton prénom</b>, et ceux des enfants dont tu gères la liste.</li>
          <li><b>Tes envies</b> et les groupes qui peuvent les voir.</li>
          <li><b>Les cadeaux que tu choisis d’offrir</b> et tes Secret Santa.</li>
        </ul>

        <h2>Qui voit quoi</h2>
        <ul>
          <li>Les membres d’un groupe voient ton prénom et les envies que tu y as rangées.</li>
          <li><b>Personne ne voit ce qu’on te prépare</b> : ni les réservations faites pour toi, ni qui t’a tiré au Secret Santa. Cette règle est appliquée par la base de données elle-même.</li>
          <li>Ta page « Ce que j’offre » et tes coches Secret Santa ne sont visibles que par toi.</li>
        </ul>

        <h2>Où c’est stocké</h2>
        <ul>
          <li>Les données sont hébergées par <b>Supabase</b>, en Europe.</li>
          <li>Les e-mails de connexion sont envoyés par <b>Brevo</b>, qui compte les ouvertures et les clics de façon anonyme.</li>
          <li>Aucune publicité, aucune revente, aucun pistage.</li>
        </ul>

        <h2>Tes droits</h2>
        <ul>
          <li>Tu peux modifier ton prénom et tes envies à tout moment.</li>
          <li>Tu peux <b>supprimer ton compte</b> et tout ce qui est à toi : dans l’appli, « Mon compte » en bas de page.</li>
          <li>Pour toute question : {CONTACT ? <a href={`mailto:${CONTACT}`}>{CONTACT}</a> : 'écris à la personne qui t’a invité·e dans La Hotte.'}</li>
        </ul>
      </section>
      <p style={{ marginBlock: 24 }}><a href="/">← Retour à La Hotte</a></p>
    </main>
  );
}
