export function NotConfigured() {
  return (
    <div className="wrap centered">
      <div className="panel">
        <h1>Presque prêt</h1>
        <p className="sub">La Hotte n’est pas encore reliée à sa base de données.</p>
        <p className="note">Copie <code>.env.local.example</code> en <code>.env.local</code>, remplis l’adresse et la clé de ton projet Supabase, puis relance <code>npm run dev</code>. Toutes les étapes sont dans le README.</p>
      </div>
    </div>
  );
}
