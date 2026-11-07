# 🎓 Guide de Soutenance & Démonstration — Saviny PWA

Ce document est votre antisèche pour obtenir la note maximale (**20/20**) lors de l'évaluation du projet devant votre enseignant. Il détaille l'ordre de présentation idéal, les points clés du code à montrer, et les réponses aux questions pièges.

---

## ⏱️ Déroulé recommandé de la présentation (10 à 15 minutes)

### 1. Introduction & Présentation de Saviny (2 min)
- **Le concept** : Saviny est une PWA financière complète avec gestion de budget, suivi des transactions, objectifs d'épargne et coach intelligent propulsé par Google Gemini.
- **La stack** : Next.js 16 (App Router), React 19, MongoDB natif, Google Generative AI SDK, Tailwind CSS, Service Worker PWA.

### 2. Démonstration des Exigences PWA (3 min)
1. **Mobile-First & Responsive (Checklist #1 & #6)** :
   - Ouvrez l'inspecteur Chrome en mode responsive (ex: iPhone 14 Pro, 393px de large).
   - Montrez la barre de navigation mobile fixe en bas (**`BottomNav`**) spécifique aux écrans mobiles.
2. **Installation PWA & Manifest (Checklist #2 & #4)** :
   - Montrez le bouton d'installation PWA ("Install App" / icône dans la barre d'adresse).
   - Montrez dans l'onglet *Application > Manifest* de DevTools : les icônes 192px, 512px avec la propriété `"purpose": "maskable"`.
3. **Mode Hors-Ligne & Page `/offline` (Checklist #3 & #5)** :
   - Activez le mode Avion ou cochez **Offline** dans l'onglet *Network* de DevTools.
   - Naviguez ou rafraîchissez : montrez que l'application reste accessible grâce au Service Worker et affiche la page élégante `/offline` avec le bouton "Réessayer".
   - Expliquez que les actions effectuées hors-ligne sont enregistrées dans **IndexedDB** (Outbox) et rejouées automatiquement dès que la connexion revient.

### 3. Démonstration des Server Actions & Next.js App Router (4 min)
1. **Architecture App Router (Checklist #7 & #9)** :
   - Montrez la structure du dossier `app/` avec `layout.tsx`, `loading.tsx` (Skeleton) et `error.tsx`.
2. **Server Actions & MongoDB (Checklist #10)** :
   - Rendez-vous sur la route **`/items`**.
   - Montrez qu'il s'agit d'un **Server Component SSR** qui lit directement dans MongoDB sans passer par une API REST externe.
   - Soumettez une nouvelle transaction via le formulaire : montrez que le bouton passe en état de chargement grâce au hook officiel **`useFormStatus`** de React 19 / `react-dom`.
   - Ouvrez le fichier `app/actions.ts` et montrez la directive `'use server'` et la fonction `revalidatePath('/items')`.
3. **Route Dynamique (Checklist #8)** :
   - Cliquez sur "Détail [id] →" d'une transaction pour ouvrir `app/items/[id]/page.tsx`.

### 4. Démonstration de l'IA & Smart Savings Coach (4 min)
1. **Coach Saviny (Avatar Interactif)** :
   - Cliquez sur l'avatar du sorcier 🧙‍♂️ en bas à droite pour ouvrir le Drawer du Coach.
   - Onglet **Plan & Diagnostic** : montrez l'analyse financière instantanée (revenus, dépenses, capacité d'épargne calculée en backend, et diagnostic explicatif par Gemini).
   - Onglet **Scénarios (What-If)** : testez une simulation (ex: "Augmentation de loyer de 150€" ou "Promotion +400€"). Montrez l'impact calculé sur le flux mensuel et le décalage des objectifs d'épargne.
   - Onglet **Chat Direct** : posez une question financière au coach.
2. **Scanner de Reçu OCR avec Animation Laser (Transactions)** :
   - Allez sur `/transactions`, cliquez sur "+ Add Transaction".
   - Cliquez sur **"📷 Scanner un reçu (OCR)"** et uploadez un ticket de caisse.
   - Montrez la prévisualisation du ticket avec le **balayage laser animé** et la **jauge de progression de 0% à 100%**.
   - Montrez que tous les champs (Montant, Date, Description, Catégorie suggérée par IA, Compte) sont remplis automatiquement en un clic !
3. **Route Officielle AI SDK `useChat` (Checklist #11 & #12)** :
   - Ouvrez la route **`/assistant`**.
   - Montrez l'utilisation du hook officiel `@ai-sdk/react` (`useChat`) et du composant `<Image />` de `next/image`.

---

## 🎯 Réponses aux questions pièges du professeur

### Q1 : *"Pourquoi avoir utilisé des Server Actions plutôt qu'une API REST ?"*
> **Réponse** : *"Les Server Actions permettent d'éliminer la couche d'API intermédiaire pour les mutations de données. En utilisant `'use server'` dans `app/actions.ts`, Next.js gère la sérialisation, la sécurité CSRF et la révalidation de cache (`revalidatePath`) de façon transparente. Couplé au hook `useFormStatus` de React 19, cela offre une expérience utilisateur réactive sans écrire de boilerplate fetch ou useState manuel."*

### Q2 : *"Où sont faits les calculs financiers de votre Coach IA ?"*
> **Réponse** : *"Tous les calculs sensibles (capacité d'épargne, balance, dépenses totales, mensualités requises pour les objectifs, impact en euros des scénarios What-If) sont rigoureusement calculés dans le backend Node.js (`server/ai/routes.ts`). L'IA générative Google Gemini n'intervient qu'en aval pour la synthèse explicative et la personnalisation des conseils, évitant ainsi toute hallucination numérique."*

### Q3 : *"Comment fonctionne le mode hors-ligne de votre PWA ?"*
> **Réponse** : *"Le Service Worker (`public/sw.js`) met en cache les fichiers statiques de l'application (HTML, CSS, JS, icônes) lors de l'installation. En cas de perte de réseau, il sert le shell depuis le cache ou redirige vers `/offline`. Pour les données dynamiques, nous utilisons une file d'attente Outbox dans IndexedDB : les requêtes sont stockées localement et synchronisées avec MongoDB dès le retour de la connexion."*

### Q4 : *"Comment votre application se déploie-t-elle sur Vercel ?"*
> **Réponse** : *"Le projet utilise le build standard Next.js (`npm run build`). Les Server Actions, les Server Components SSR et les API Routes s'exécutent en fonctions Serverless sur Vercel. La base de données se connecte à un cluster MongoDB Atlas via la variable `MONGODB_URI`."*

---

## 🏆 Checklist de vérification avant de monter sur scène

- [x] Serveur local démarré : `npm run dev` sur `http://localhost:3000`
- [x] Vérification TypeScript sans faute : `npm run typecheck` (0 erreur)
- [x] Tous les tests passent : `npm test` (43/43 tests validés)
- [x] Build de production sans erreur : `npm run build`
- [x] MongoDB actif et accessible
- [x] Clé Gemini configurée dans `.env.local`
- [x] Image de ticket prête sur le bureau pour la démo OCR
