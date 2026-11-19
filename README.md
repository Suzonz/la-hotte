# La Hotte

Listes de Noël partagées. Chacun note ses envies et les range dans des groupes (Famille, Amis, Collègues…). Les membres d'un groupe réservent un cadeau (« je l'offre »), cotisent (« je participe ») ou signalent un cadeau hors liste. **Personne ne voit jamais ce qu'on lui prépare.**

- **Next.js 15** (App Router, TypeScript) pour l'interface.
- **Supabase** pour la base Postgres et la connexion par lien magique envoyé par e-mail.
- **Confidentialité garantie côté serveur.** Les règles Row Level Security de Postgres ([supabase/migrations/0001_init.sql](supabase/migrations/0001_init.sql)) décident ce que chaque personne reçoit. Une réservation faite pour toi n'arrive jamais dans ton navigateur, même en fouillant le réseau.

## Fonctionnalités

- Connexion sans mot de passe, par lien reçu par e-mail.
- Groupes : création, renommage, lien d'invitation (qu'on peut changer), ajout de personnes déjà connues, retrait d'un membre (par le créateur, ou par la personne qui l'a ajouté), départ, suppression.
- Envies : lien, prix, niveau d'envie, précisions. On choisit qui la voit (un ou plusieurs groupes, ou « Seulement moi »), rien n'est coché d'office. Filtre par groupe.
- Réservations : « je l'offre » (un seul acheteur par cadeau), cagnotte avec barre de progression, cadeau hors liste. Quelqu'un d'un autre groupe apparaît comme « quelqu'un d'un autre groupe ».
- Alertes pour l'acheteur quand l'envie est modifiée ou retirée après son choix.
- Enfants sans compte, gérés par **un ou plusieurs parents**, tous égaux. Les parents voient les réservations faites pour leur enfant.
- « Ce que j'offre » : tout ce qu'on offre au même endroit, trié par personne ou par groupe, avec « Offert ✓ ».
- Après la fête : « Reçu ✓ » sur ses envies, puis « Préparer l'année prochaine » range tout.
- **Mises à jour en direct** : une réservation apparaît chez les autres sans recharger.
- **Récapitulatif par e-mail**, au plus un par jour, désactivable.
- « Mon compte » : supprimer son compte et ses données ; page « Confidentialité ».
- **Secret Santa** par groupe, deux types choisis à la création :
  - **tirage par La Hotte** : tirage au sort par le serveur, avec exclusions (un couple ne se tire pas entre eux) ; personne, pas même l'organisateur, ne voit les paires ;
  - **tirage déjà fait** (papiers, autre site) : chacun indique la personne qu'il a tirée ; l'organisateur voit seulement qui ne l'a pas encore fait.

  Chacun ne voit que son tirage jusqu'à la **date de révélation** (par défaut le lendemain de l'échange). Après le tirage, retirer un participant raccroche la chaîne (une seule personne change de destinataire, et elle est prévenue) ; en ajouter un oblige à refaire le tirage. Suivi privé du cadeau : case 🎅 sur ses réservations, statut « en cours » / « complet » dans « Ce que j'offre ».

## Installation

### 1. Créer le projet Supabase (gratuit)

1. Crée un compte sur [supabase.com](https://supabase.com), puis un nouveau projet.
2. **SQL Editor** → colle le contenu de `supabase/migrations/0001_schema.sql` → **Run**. C'est le schéma complet.
   *(Un projet déjà monté avec les six fichiers de `supabase/archive/` est identique : il n'y a rien à refaire.)*
3. **Authentication → URL Configuration** :
   - *Site URL* : `http://localhost:3123` (puis l'adresse du site en ligne quand il sera déployé) ;
   - *Redirect URLs* : ajoute `http://localhost:3123/auth/callback` (et plus tard `https://ton-site/auth/callback`).
4. **Pour développer, c'est tout.** Avec l'e-mail par défaut de Supabase, le lien de connexion s'ouvre **dans le même navigateur** que celui où il a été demandé.

5. **Pour un vrai usage** : le service d'e-mail intégré à Supabase n'envoie que quelques e-mails par heure, et il ne permet pas de modifier les e-mails. Branche un fournisseur d'e-mails (Resend, Brevo…) dans *Authentication → Emails → SMTP Settings*, puis, dans *Emails → Magic link or OTP*, remplace le lien du modèle par :
   ```
   {{ .RedirectTo }}&token_hash={{ .TokenHash }}&type=email
   ```
   (`{{ .RedirectTo }}` vaut déjà `…/auth/callback?next=…`, que l'appli envoie pour ramener un invité vers son groupe.)
   Le lien marche alors sur n'importe quel appareil (demandé sur l'ordinateur, ouvert sur le téléphone).
   Profites-en pour remplacer l'expéditeur « Supabase Auth » par **La Hotte** (*SMTP Settings → Sender name*) et pour écrire l'objet et le texte de l'e-mail en français : sans ça, les invités ne comprennent pas d'où vient l'e-mail.

### Mettre à jour un projet existant

Chaque nouveauté de la base est un fichier de `supabase/migrations/`, numéroté. Dans **SQL Editor**, exécute **dans l'ordre** ceux que ton projet n'a pas encore eus, une seule fois chacun :

| Fichier | Ce qu'il apporte |
|---|---|
| `0001_schema.sql` | Le schéma complet (listes, groupes, réservations, Secret Santa) |
| `0002_realtime_and_account.sql` | Mises à jour en direct, suppression de son compte |
| `0003_coparents_and_after_christmas.sql` | Deux parents pour un enfant, « Reçu », « Offert », nouvelle année |
| `0004_email_digest.sql` | Le récapitulatif quotidien par e-mail (à activer, voir ci-dessous) |

L'avertissement « destructive operations » de Supabase est normal : ces fichiers ajoutent des choses, ils n'effacent pas tes données.

### Activer le récapitulatif par e-mail (facultatif)

Un e-mail par jour au plus, envoyé chaque matin vers 8 h (heure de Paris en hiver) par Brevo, seulement à ceux qui ont des nouvelles et ne l'ont pas désactivé dans « Mon compte ». Il ne dévoile jamais une surprise.

1. **Brevo → SMTP et API → onglet « Clés API » → Générer une nouvelle clé API.** C'est une clé différente de la clé SMTP ; copie-la.
2. **Supabase → SQL Editor**, en remplaçant les trois valeurs :
   ```sql
   select vault.create_secret('xkeysib-ta-cle-api', 'brevo_api_key');
   select vault.create_secret('adresse.validee@dans-brevo.fr', 'la_hotte_sender');
   select vault.create_secret('https://adresse-du-site', 'la_hotte_site_url');
   ```
   Les secrets sont chiffrés par Supabase (Vault) : ils ne sont pas dans le code.
3. Pour essayer tout de suite plutôt que d'attendre le lendemain matin : `select public.send_digests();` (le résultat est le nombre d'e-mails envoyés).

Pour changer une valeur plus tard : `select vault.update_secret((select id from vault.secrets where name = 'brevo_api_key'), 'nouvelle-cle');`

### 2. Lancer l'appli

```bash
cp .env.local.example .env.local   # puis remplis l'URL et la clé « anon » (Project Settings → API)
npm install
npm run dev
```

Ouvre http://localhost:3123.

### 3. Mettre en ligne (Vercel, gratuit)

1. Pousse le projet sur GitHub, puis importe-le sur [vercel.com](https://vercel.com).
2. Ajoute les deux variables `NEXT_PUBLIC_SUPABASE_URL` et `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
3. Dans Supabase, mets l'adresse Vercel dans *Site URL* et `https://…/auth/callback` dans *Redirect URLs*.

## Développer et tester en local, sans e-mail

Une copie locale de Supabase (il faut Docker) permet de tout tester avec de faux comptes :

```bash
npm run db:start    # Supabase local sur les ports 553xx (base, connexion, boîte mail de test)
npm run test:e2e    # tests d'interface : 3 faux comptes, invitation, réservation, Secret Santa
npm run db:stop
```

Les tests d'interface lancent leur propre serveur (port 3124) relié à la base locale ; ils ne touchent jamais au vrai projet. Ils enregistrent aussi des captures des écrans principaux dans `test-results/screens/`.

## Tests

```bash
npm run test:db     # règles de confidentialité, sur un vrai Postgres local (PGlite), sans Docker
npm run test:e2e    # tests d'interface (Playwright), avec Supabase local
npm run typecheck
```

`tests/schema.test.mjs` vérifie que le schéma fusionné donne exactement la même base que les six fichiers d'origine.

`tests/rls.test.mjs` simule quatre personnes et deux groupes, et vérifie entre autres :
- personne ne voit les réservations faites pour soi, mais un parent voit celles faites pour son enfant ;
- chaque groupe ne voit que ses envies, et on n'apprend pas l'existence des autres groupes ;
- impossible de réserver une envie invisible, sa propre envie, ou un cadeau déjà pris ;
- les règles pour ajouter et retirer des membres, et pour changer le lien d'invitation ;
- personne ne peut modifier la liste ou les réservations d'un autre.

## Organisation du code

```
supabase/migrations/   schéma complet + règles de sécurité (la référence)
supabase/archive/      les six étapes du développement, gardées pour l'historique
src/app/               pages : accueil, /login, /auth/callback, /rejoindre/[code]
src/lib/hotte.tsx      chargement des données, calculs, toutes les actions
src/components/        écrans : ListPage, ManageWishes, GroupView, GroupSettings, PersonView, WishCard, GiftsView…
src/components/santa/  Secret Santa : encadré du groupe, création, carte, participants, suivi des cadeaux
tests/                 règles de la base (PGlite) et tests d'interface (tests/e2e, Playwright)
src/middleware.ts      session et redirection vers /login
```

## Entretien (offres gratuites)

- **Supabase** met en pause un projet gratuit resté 7 jours sans activité : tableau de bord → *Restore project*. Les données sont conservées.
- **Brevo** : une clé SMTP expire à sa date d'expiration (1 an) **ou après 90 jours sans envoi**. Si plus personne ne reçoit les e-mails de connexion, génère une nouvelle clé (*SMTP et API → Générer une nouvelle clé SMTP*) et colle-la dans Supabase (*Authentication → Emails → SMTP Settings → Password*).
- N'active pas le blocage des « adresses IP non autorisées » dans Brevo : Supabase envoie depuis des adresses qui changent, les e-mails seraient bloqués.

- **Clé API Brevo** (récapitulatif par e-mail) : si les e-mails ne partent plus, vérifie qu'elle est toujours valide dans Brevo, puis mets-la à jour dans Vault (commande ci-dessus).

## Limites connues

- Les anniversaires (une liste par occasion, avec sa date) ne sont pas encore prévus : on réutilise la même liste d'une fête à l'autre, avec « Préparer l'année prochaine ».
- Le récapitulatif par e-mail part à heure fixe en UTC : 8 h à Paris en hiver, 9 h en été.
