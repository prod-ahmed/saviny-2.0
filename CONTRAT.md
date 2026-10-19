# Saviny PWA — contrat partagé API ↔ Web

Source de vérité : `/Users/ahmedbt/Desktop/Saviny/Cahier_des_charges_Saviny.pdf` (v1.0).
Design de référence (ne pas le modifier visuellement) : `/Users/ahmedbt/Desktop/Saviny/Untitled/src/App.tsx` + `src/index.css`.

## Règles générales

- Application unique : Next.js 16 (App Router) à la racine. API : route handlers `app/api/[...path]/route.ts` branchés sur un dispatcher (`server/http/router.ts`). Écrans : React 19 + react-router + Tailwind v4 dans `client/`, montés par la page catch-all `app/[[...slug]]`. Temps réel : Socket.IO sur `/api/socket.io`, attaché au serveur HTTP de `server.ts`.
- Préfixe API : `/api`. Un seul port (3000 par défaut) : Next.js sert l'application (shell `index.html` pour toute route hors `/api`) et les routes API.
- Montants : nombres décimaux (2 décimales) côté JSON. Dates : ISO `YYYY-MM-DD` ou ISO complet.
- Erreurs : `{ "statusCode": number, "message": string | string[], "error": string }` (format Nest standard). Messages en anglais (comme le design).
- Données personnelles : jamais dans les logs, jamais en clair dans le stockage navigateur (seul le jeton de session peut être dans `localStorage`, clé `saviny.token`).
- Mots de passe : `crypto.scrypt` (node:crypto), jamais en clair, jamais renvoyés.
- Jetons de session : jeton opaque aléatoire (32 octets, base64url) envoyé en `Authorization: Bearer <token>`. Côté serveur on ne stocke que son SHA-256. Déconnexion = révocation.
- Droits : chaque ressource est filtrée par `userId` ; un utilisateur ne voit ni ne modifie les données d'un autre (404 si ressource non trouvée pour lui). Modération : rôle `moderator` (utilisateurs listés dans la variable d'env `MODERATOR_EMAILS`).
- Persistance : SQLite dans `data/saviny.db` (variable `DATABASE_FILE`), pièces jointes dans `data/media` (variable `MEDIA_DIR`). Le dossier `data/` est dans `.gitignore`. Ne jamais supprimer ces fichiers automatiquement.
- Seed démo : si `SEED_DEMO=true`, création au démarrage de l'utilisateur `alex.morgan@example.com` / mot de passe `saviny-demo` avec des données qui reproduisent exactement le design (comptes, transactions, budgets, objectifs, annonces, discussions). Ne rien seed sinon.
- Sécurité HTTP : en-têtes (`nosniff`, `SAMEORIGIN`, `Referrer-Policy`), validation `zod` stricte (clés inconnues refusées, 400 sinon), CORS restreint (`CORS_ORIGIN`, défaut `http://localhost:5173`), rate limit en mémoire sur `/api/auth/*` (10/min inscription, 5/min connexion) et global (300/min par adresse).

## Endpoints

### Santé
- `GET /api/health` → `{ status: "ok" }`

### Auth
- `POST /api/auth/register` `{ firstName, lastName, email, password (≥8), confirmPassword }` → `{ token, user }`
- `POST /api/auth/login` `{ email, password }` → `{ token, user }` (401 générique si mauvais identifiants)
- `POST /api/auth/logout` (auth) → `204` et session révoquée
- `GET /api/auth/me` (auth) → `user`
- `user` = `{ id, firstName, lastName, email, role, currency, memberSince, notifications: { budgetAlerts, upcomingBills, savingsMilestones, communityReplies, marketplaceMessages } }`

### Profil & sécurité
- `PATCH /api/users/me` `{ firstName?, lastName?, email?, currency? }`
- `POST /api/users/me/password` `{ currentPassword, newPassword }` → `204`
- `PATCH /api/users/me/notifications` `{ budgetAlerts?, upcomingBills?, savingsMilestones?, communityReplies?, marketplaceMessages? }`
- `POST /api/users/me/delete-request` `{ confirmation: "DELETE" }` → `202` (marque le compte `deletionRequestedAt`, ne supprime rien immédiatement)

### Tableau de bord
- `GET /api/dashboard?period=this_month|last_month|last_3_months|this_year` →
  `{ balance, income, expenses, saved, activeAccounts, activeGoals, incomeCount, expenseCount, byCategory: [{ categoryId, name, amount, percent }], weeklyFlow: [{ label, income, expenses }], budgets: [...], goals: [...], recentTransactions: [...], upcomingBills: [...], alerts: [...] }`
- `balance` = somme des soldes initiaux des comptes actifs + revenus − dépenses (toutes dates).

### Comptes (Module 1)
- `GET /api/accounts`, `POST /api/accounts` `{ name, type: "checking"|"savings"|"cash"|"credit", initialBalance }`
- `GET|PATCH|DELETE /api/accounts/:id` — `balance` calculé (initialBalance + revenus − dépenses). `PATCH` ne change jamais le solde calculé.
- `POST /api/accounts/:id/archive` → archive (retiré des totaux actifs, historique conservé). `DELETE` supprime le compte et ses transactions.

### Catégories (Module 1)
- `GET /api/categories`, `POST /api/categories` `{ name }`, `PATCH|DELETE /api/categories/:id` (archive si utilisée, supprime sinon).
- Catégories par défaut créées à l'inscription : `Food`, `Transport`, `Housing`, `Leisure`, `Health`, `Education`, `Income`, `Savings`.

### Transactions (Module 1)
- `GET /api/transactions?type=income|expense&accountId&categoryId&search&from&to&page&pageSize` → `{ items, total }`
- `POST /api/transactions` `{ type, amount (>0), date, description?, accountId, categoryId }` → transaction (montant stocké positif, signe dérivé du type)
- `GET|PATCH|DELETE /api/transactions/:id`
- Transaction = `{ id, type, amount, date, description, accountId, accountName, categoryId, categoryName, createdAt }`

### Transactions récurrentes (Module 1)
- `GET|POST /api/recurring`, `PATCH|DELETE /api/recurring/:id` `{ active?: boolean, frequency: "weekly"|"monthly"|"yearly", nextDate, amount, type, accountId, categoryId, description }`
- Règle : une récurrence ne crée jamais de transaction automatiquement en v1 ; elle est listée et confirmable.

### Budgets (Module 2)
- `GET|POST /api/budgets` `{ name, limit (>0), period: "monthly"|"weekly"|"custom", startDate?, endDate?, categoryIds: string[] }`
- `GET|PATCH|DELETE /api/budgets/:id`
- Calculés sur chaque budget : `spent` (somme des dépenses des catégories liées dans la période), `remaining = max(0, limit − spent)`, `overBy = max(0, spent − limit)`, `percent = round(spent/limit*100)`, `status: "on_track"|"near_limit"|"over"` (near_limit à partir de 80 %).

### Factures & paiements planifiés (Module 2)
- `GET|POST /api/bills`, `GET|PATCH|DELETE /api/bills/:id` `{ name, amount, dueDate, kind: "bill"|"scheduled", status: "upcoming"|"paid", accountId? }`
- `POST /api/bills/:id/mark-paid` → passe en `paid`. **Aucun paiement réel ni virement n'est déclenché.**

### Objectifs d'épargne (Module 3)
- `GET|POST /api/goals` `{ title, description?, targetAmount (>0), targetDate? }`
- `GET|PATCH|DELETE /api/goals/:id` — calculés : `savedAmount` (somme des contributions), `remaining = max(0, target − saved)`, `progress = min(100, round(saved/target*100))`, `estimatedCompletionDate` (si contributions et date ; sinon null, avec `estimationNote`).
- `POST /api/goals/:id/archive` → archive un objectif (statut `archived`) ; `status` = `active|completed|archived`.
- `GET|POST /api/goals/:id/contributions` `{ amount (>0), date, note? }`
- `PATCH|DELETE /api/contributions/:id`

### Marketplace (Module 4)
- `GET /api/listings?q&category&maxPrice&page&pageSize` (annonces `available` uniquement, sauf `mine=true`)
- `POST /api/listings` `{ title, description, price (>0), category, condition: "New"|"Like new"|"Good"|"Fair", photos: string[] (URL https ou data:image/* ≤ 500 Ko, max 5) }`
- `GET|PATCH|DELETE /api/listings/:id` — modification et suppression **réservées au vendeur** (403 sinon).
- `POST /api/listings/:id/status` `{ status: "available"|"unavailable"|"sold" }` (vendeur seul)
- `POST /api/listings/:id/sale` `{ outcome: "completed"|"cancelled", amount? }` (vendeur seul). `completed` → annonce `sold`.
- `PUT|DELETE /api/listings/:id/favorite` (ajout / retrait), `GET /api/favorites`
- `POST /api/listings/:id/messages` `{ body }` (contacter le vendeur) ; `GET /api/messages` (boîte de réception du vendeur, et messages envoyés).

### Community (Module 6)
- `GET /api/posts?category&q&sort=popular|recent&page&pageSize`. Catégories : `All discussions`, `Saving Tips`, `Budgeting`, `Financial Goals`, `Student Life`, `General`.
- `POST /api/posts` `{ title, content, category }` ; `GET|PATCH|DELETE /api/posts/:id` (auteur seul pour modifier ; auteur ou modérateur pour supprimer).
- Post = `{ id, title, excerpt, content, category, author: { id, name, initials }, createdAt, replyCount, reactionCount, viewerReacted }`
- `GET|POST /api/posts/:id/comments` `{ body }` ; `PATCH|DELETE /api/comments/:id` (auteur seul ; modérateur pour supprimer)
- `PUT|DELETE /api/posts/:id/reaction` — une seule réaction active par utilisateur et par publication (idempotent).
- `GET /api/community/trending` → 3 sujets les plus discutés des 7 derniers jours, calculés sur les interactions réelles (commentaires + réactions).
- `GET /api/community/rules` → `{ rules: string[] }` (règles de bonne conduite)
- `POST /api/reports` `{ targetType: "post"|"comment", targetId, reason }` ; `GET /api/reports` et `POST /api/reports/:id/resolve` `{ hideContent: boolean }` (modérateur seul ; masquer = contenu invisible pour tous, auteur conserve ses données).

### Notifications (transverses)
- `GET /api/notifications?unreadOnly=true|false` → `{ items: [{ id, kind, title, body, createdAt, read, link }], unreadCount }`
- Créées automatiquement : réponse à sa publication, réponse à son commentaire, interaction importante sur une discussion suivie.
- `POST /api/notifications/:id/read`, `POST /api/notifications/read-all`

## Règles de gestion (à tester)
- Transaction : montant > 0, type et date obligatoires, appartient à l'utilisateur, le compte et la catégorie doivent lui appartenir.
- Totaux recalculés à chaque lecture (jamais stockés en double).
- Annonce : seul le propriétaire modifie/supprime ; annonce vendue ou indisponible n'apparaît plus dans le catalogue public.
- Un utilisateur ne modifie que ses propres données (profil, annonces, publications, commentaires).
- Les mots de passe ne sont jamais en clair ; la session est révoquée à la déconnexion.

## Contraintes Web/PWA (côté front)
- Le design (classes CSS, disposition, textes anglais) reste identique à `Untitled/`. On remplace uniquement les données mockées par des appels API.
- Installable : `manifest.webmanifest` (name `Saviny`, short_name `Saviny`, theme `#102a29`, background `#f6f8f7`, display `standalone`, icônes 192/512 générées depuis `public/assets/saviny-logo.png`).
- Service worker : met en cache le shell (HTML, JS, CSS, logo, manifest) et uniquement les réponses publiques de lecture (`/api/community/rules`, `/api/posts` et `/api/community/trending`). **Jamais** les données personnelles (comptes, transactions, budgets, objectifs, messages, notifications). Hors ligne : écran "Offline" et écritures désactivées avec le message "Connection required — nothing was saved".
- Un bandeau indique l'état réseau réel (`navigator.onLine` + événements `online`/`offline`).

## Connexion Google et GitHub

- `GET /api/auth/providers` → `{ google: boolean, github: boolean }` : un bouton n'est affiché que si le fournisseur est configuré.
- `GET /api/auth/oauth/:provider/start` (`google` ou `github`) → redirection vers le fournisseur avec un `state` à usage unique (10 min).
- `GET /api/auth/oauth/:provider/callback` → crée ou retrouve le compte, puis redirige vers `/login?oauth=<code>`. Le code est à usage unique et expire en 2 min. En cas d'échec : `/login?oauth_error=oauth_denied | oauth_unverified | oauth_failed | oauth_unavailable`.
- `POST /api/auth/oauth/exchange` `{ code }` → `{ token, user }`. Le jeton de session n'apparaît jamais dans une URL.
- Un compte est retrouvé par identité fournisseur, puis par e-mail **vérifié** (Google `email_verified`, GitHub e-mail principal et vérifié). Sinon un nouveau compte est créé, sans mot de passe utilisable.

Variables d'environnement :

| Variable | Rôle |
|---|---|
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | identifiants de l'application OAuth Google |
| `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` | identifiants de l'application OAuth GitHub |
| `PUBLIC_URL` | origine publique de l'application (défaut `http://localhost:3000`) |

URL de redirection à enregistrer chez chaque fournisseur :

- Google : `${PUBLIC_URL}/api/auth/oauth/google/callback`
- GitHub : `${PUBLIC_URL}/api/auth/oauth/github/callback`
