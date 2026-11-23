# La Hotte

[![Tests](https://github.com/Suzonz/la-hotte/actions/workflows/ci.yml/badge.svg)](https://github.com/Suzonz/la-hotte/actions/workflows/ci.yml) [![Licence MIT](https://img.shields.io/badge/licence-MIT-green.svg)](LICENSE)

**👉 Essayer : [la-hotte-alpha.vercel.app](https://la-hotte-alpha.vercel.app)** (connexion par e-mail, sans mot de passe)

Listes de Noël partagées. Chacun note ses envies et les range dans des groupes (Famille, Amis, Collègues…). Les membres d'un groupe réservent un cadeau (« je l'offre »), cotisent (« je participe ») ou signalent un cadeau hors liste. **Personne ne voit jamais ce qu'on lui prépare.**

- **Next.js 15** (App Router, TypeScript) pour l'interface.
- **Supabase** pour la base Postgres et la connexion par lien magique envoyé par e-mail.
- **Confidentialité garantie côté serveur.** Les règles Row Level Security de Postgres ([supabase/migrations/0001_schema.sql](supabase/migrations/0001_schema.sql)) décident ce que chaque personne reçoit. Une réservation faite pour toi n'arrive jamais dans ton navigateur, même en fouillant le réseau.

## Fonctionnalités

- Connexion sans mot de passe, par lien reçu par e-mail.
- Groupes : création, renommage, lien d'invitation (qu'on peut changer), ajout de personnes déjà connues, retrait d'un membre (par le créateur, ou par la personne qui l'a ajouté), départ, suppression.
- Envies : lien, prix, niveau d'envie, précisions. On choisit qui la voit (un ou plusieurs groupes, ou « Seulement moi »), rien n'est coché d'office. Filtre par groupe.
- Réservations : « je l'offre » (un seul acheteur par cadeau), cagnotte avec barre de progression, cadeau hors liste. Quelqu'un d'un autre groupe apparaît comme « quelqu'un d'un autre groupe ».
- Alertes pour l'acheteur quand l'envie est modifiée ou retirée après son choix.
- Enfants sans compte, gérés par **un ou plusieurs parents**, tous égaux. Les parents voient les réservations faites pour leur enfant.
- « Ce que j'offre » : tout ce qu'on offre au même endroit, trié par personne ou par groupe, avec « Offert ✓ ».
- Après la fête : case « Reçu » sur ses envies et « Offert » sur ses cadeaux ; ils descendent en bas de la page, puis sont effacés de la base au bout d’un mois.
- **Mises à jour en direct** : une réservation apparaît chez les autres sans recharger.
- **Récapitulatif par e-mail**, au plus un par jour, désactivable.
- « Mon compte » : supprimer son compte et ses données ; page « Confidentialité ».
- **Secret Santa** par groupe, deux types choisis à la création :
  - **tirage par La Hotte** : tirage au sort par le serveur, avec exclusions (un couple ne se tire pas entre eux) ; personne, pas même l'organisateur, ne voit les paires ;
  - **tirage déjà fait** (papiers, autre site) : chacun indique la personne qu'il a tirée ; l'organisateur voit seulement qui ne l'a pas encore fait.

  Chacun ne voit que son tirage jusqu'à la **date de révélation** (par défaut le lendemain de l'échange). Après le tirage, retirer un participant raccroche la chaîne (une seule personne change de destinataire, et elle est prévenue) ; en ajouter un oblige à refaire le tirage. Suivi privé du cadeau : case 🎅 sur ses réservations, statut « en cours » / « complet » dans « Ce que j'offre ».

## Installation

### 1. Créer le projet Supabase (gratuit) : la checklist complète

Coche dans l'ordre. Tout se fait dans le tableau de bord de [supabase.com](https://supabase.com).

**La base**

- [ ] Crée un nouveau projet (région : Europe).
- [ ] **SQL Editor** → colle **tout** `supabase/migrations/0001_schema.sql` → **Run**. C'est le seul fichier à exécuter. L'avertissement « destructive operations » est normal.
- [ ] **Database → Extensions** : vérifie que `pg_cron` et `pg_net` sont activées (le fichier les active s'il peut). Sans elles, ni ménage automatique ni récapitulatif par e-mail.

**La connexion**

- [ ] **Authentication → URL Configuration** :
  - *Site URL* : l'adresse du site (`http://localhost:3123` tant qu'il n'est pas en ligne) ;
  - *Redirect URLs* : `http://localhost:3123/auth/callback` **et** `https://adresse-du-site/auth/callback`.
- [ ] **Authentication → Emails → SMTP Settings** : branche Brevo (le service intégré de Supabase n'envoie que quelques e-mails par heure).
  - Hôte `smtp-relay.brevo.com`, port `587`, identifiant et clé SMTP donnés par Brevo (*SMTP et API*) ;
  - *Sender email* : une adresse validée dans Brevo ; *Sender name* : **La Hotte**.
- [ ] **Authentication → Emails → Magic link or OTP** : objet et texte en français, et ce lien à la place de celui du modèle :
  ```
  {{ .RedirectTo }}&token_hash={{ .TokenHash }}&type=email
  ```
  (`{{ .RedirectTo }}` vaut déjà `…/auth/callback?next=…`.) Le lien marche alors sur n'importe quel appareil, même si on l'ouvre sur le téléphone après l'avoir demandé sur l'ordinateur.

**Le récapitulatif par e-mail** (facultatif)

Un e-mail par jour au plus, vers 8 h (heure de Paris en hiver), seulement à ceux qui ont des nouvelles et ne l'ont pas désactivé dans « Mon compte ». Il ne dévoile jamais une surprise.

- [ ] **Brevo → SMTP et API → Clés API → Générer une nouvelle clé API** (ce n'est pas la clé SMTP).
- [ ] **SQL Editor**, en remplaçant les trois valeurs :
  ```sql
  select vault.create_secret('xkeysib-ta-cle-api', 'brevo_api_key');
  select vault.create_secret('adresse.validee@dans-brevo.fr', 'la_hotte_sender');
  select vault.create_secret('https://adresse-du-site', 'la_hotte_site_url');
  ```
  Les secrets sont chiffrés par Supabase (Vault) : ils ne sont pas dans le code.
- [ ] Pour essayer tout de suite : `select public.send_digests();` (le résultat est le nombre d'e-mails envoyés).

Pour changer une valeur plus tard : `select vault.update_secret((select id from vault.secrets where name = 'brevo_api_key'), 'nouvelle-cle');`

**L'appli**

- [ ] **Project Settings → API** : copie l'URL du projet et la clé publique (*anon* / *publishable*) dans `.env.local` (et dans Vercel, voir plus bas). Jamais la clé secrète (*service_role* / *secret*).

*Un projet plus ancien, déjà monté avec les fichiers 0001 à 0004 d'avant : exécute seulement `supabase/archive/0010_auto_cleanup.sql`.*

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
npm run typecheck   # TypeScript
npm run lint        # ESLint (règles Next.js et TypeScript)
```

À chaque envoi sur GitHub, **GitHub Actions** relance tout (lint, types, base, build, puis tests d’interface avec un Supabase local) : voir l’onglet *Actions* du dépôt.

`tests/schema.test.mjs` vérifie que le schéma unique donne exactement la même base que les dix fichiers d’origine.

`tests/rls.test.mjs` simule quatre personnes et deux groupes, et vérifie entre autres :
- personne ne voit les réservations faites pour soi, mais un parent voit celles faites pour son enfant ;
- chaque groupe ne voit que ses envies, et on n'apprend pas l'existence des autres groupes ;
- impossible de réserver une envie invisible, sa propre envie, ou un cadeau déjà pris ;
- les règles pour ajouter et retirer des membres, et pour changer le lien d'invitation ;
- personne ne peut modifier la liste ou les réservations d'un autre.

## Organisation du code

```
supabase/migrations/   le schéma complet, en un seul fichier (la référence)
supabase/archive/      les dix étapes du développement, gardées pour l’historique
src/app/               pages : accueil, /login, /auth/callback, /rejoindre/[code]
src/lib/hotte.tsx      état de l’appli (useHotte) : relie les trois fichiers suivants
src/lib/data.ts        chargement de tout ce que la personne a le droit de voir
src/lib/derive.ts      calculs (qui voit quoi, qui offre quoi) à partir de ces données
src/lib/actions.ts     toutes les actions (ajouter une envie, réserver, tirage…)
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

- Les anniversaires (une liste par occasion, avec sa date) ne sont pas encore prévus : on réutilise la même liste d'une fête à l'autre.
- Le récapitulatif par e-mail part à heure fixe en UTC : 8 h à Paris en hiver, 9 h en été.

## Licence

MIT, voir [LICENSE](LICENSE).
