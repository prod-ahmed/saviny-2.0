# Saviny — Smart Savings & Financial PWA

> Application Progressive Web App (PWA) développée avec **Next.js 16**, **React 19**, **MongoDB**, et l'**IA Générative Google Gemini**.

[![Next.js](https://img.shields.io/badge/Next.js-16.4.2-black)](https://nextjs.org/)
[![React](https://img.shields.io/badge/React-19.0-61DAFB)](https://react.dev/)
[![MongoDB](https://img.shields.io/badge/MongoDB-Native%20Driver-47A248)](https://www.mongodb.com/)
[![Google Gemini](https://img.shields.io/badge/Google%20Gemini-Flash%20Lite-4285F4)](https://ai.google.dev/)
[![PWA Ready](https://img.shields.io/badge/PWA-Offline%20%2B%20IndexedDB-orange)](https://web.dev/progressive-web-apps/)
[![Vercel Compatible](https://img.shields.io/badge/Vercel-Ready-black)](https://vercel.com/)

---

## 🌟 Présentation du projet

**Saviny** est une application financière intelligente conçue pour aider les utilisateurs à gérer leur budget, suivre leurs transactions, atteindre leurs objectifs d’épargne, et obtenir des conseils financiers personnalisés grâce à son **Coach Intelligent (Saviny AI – Smart Savings Coach)**.

### Points forts & Innovations :
1. **🧙‍♂️ Coach Intelligent Saviny (Avatar interactif)** :
   - Analyse automatique des revenus, dépenses, flux nets et capacité d’épargne.
   - Diagnostic financier hebdomadaire et mensuel généré par Gemini Flash.
   - Détection des risques de retard sur les objectifs d’épargne avec recommandations de coupes budgétaires.
   - **Simulateur de scénarios "What-If"** : impact en temps réel de changements financiers (augmentation de loyer, promotion, coupe d'abonnements) sur les dates d'atteinte des objectifs.
2. **📷 Scanner de reçu intelligent (OCR & Animation Laser)** :
   - Scan visuel haute fidélité avec faisceau laser animé et jauge de progression en temps réel (0 % à 100 %).
   - Extraction multimodale de l’image (montant, date, commerçant/articles, catégorie recommandée).
   - Remplissage automatique instantané de tous les champs du formulaire.
3. **📶 PWA 100 % Fonctionnelle hors-ligne** :
   - Service Worker avec stratégie Cache-First / Network-First.
   - Page dédiée élégante `/offline` en cas de coupure réseau complète.
   - File d'attente hors-ligne (Outbox) synchronisée dans IndexedDB.
4. **⚡ Next.js App Router & Server Actions** :
   - Persistance directe via `app/actions.ts` (`'use server'`).
   - Boutons de soumission utilisant le hook officiel `useFormStatus` (`react-dom`).
   - Server Components SSR (`/items`, `/items/[id]`) avec streaming et revalidation immédiate (`revalidatePath`).

---

## 📋 Grille de conformité au cours (14 Exigences)

| # | Exigence du cours | Statut | Emplacement dans le code |
|---|---|---|---|
| **#1** | **Responsive Design** (mobile-first, max 430px) | ✅ Conforme | `client/index.css`, navigation adaptative Tailwind |
| **#2** | **Manifest PWA** complet avec icône `maskable` | ✅ Conforme | `public/manifest.json` (`purpose: "any maskable"`) |
| **#3** | **Service Worker** avec mise en cache | ✅ Conforme | `public/sw.js` (pré-cache shell, offline, assets) |
| **#4** | **Installation PWA** (Bannière / bouton) | ✅ Conforme | `client/components/PwaPrompt.tsx` |
| **#5** | **Mode hors-ligne** avec page `/offline` | ✅ Conforme | `app/offline/page.tsx` & fallback SW |
| **#6** | **Navigation mobile fixe** (BottomNav) | ✅ Conforme | `client/components/BottomNav.tsx` (`fixed bottom-0`) |
| **#7** | **Architecture App Router** (`app/`) | ✅ Conforme | `app/layout.tsx`, `app/items`, `app/assistant`, `app/offline` |
| **#8** | **Route dynamique** `[id]` & `useRouter` | ✅ Conforme | `app/items/[id]/page.tsx`, `next/navigation` |
| **#9** | **Fichiers spéciaux** `loading.tsx` & `error.tsx` | ✅ Conforme | `app/loading.tsx`, `app/error.tsx` |
| **#10** | **Server Actions** + `useFormStatus` + MongoDB | ✅ Conforme | `app/actions.ts` (`'use server'`), `client/components/SubmitButton.tsx` |
| **#11** | **Hook IA** `useChat` (@ai-sdk/react) | ✅ Conforme | `app/assistant/page.tsx`, `app/api/chat/route.ts` |
| **#12** | **Optimisation** `next/image` | ✅ Conforme | `app/assistant/page.tsx`, `next/image` |
| **#13** | **Déploiement Vercel** & Git | ✅ Conforme | Build standard Next.js, compatible Serverless |
| **#14** | **Documentation & Clarté du code** | ✅ Conforme | `README.md`, `GUIDE_SOUTENANCE.md`, TypeScript strict |

---

## 🚀 Démarrage rapide

### 1. Prérequis
- **Node.js** 20+
- **MongoDB** (local sur `mongodb://127.0.0.1:27017` ou cluster [MongoDB Atlas](https://www.mongodb.com/cloud/atlas))

### 2. Installation
```bash
git clone <votre-repo-url>
cd saviny
npm install
```

### 3. Configuration des variables d'environnement
Créez un fichier `.env.local` (ou copiez `.env.example`) :
```env
MONGODB_URI=mongodb://127.0.0.1:27017/saviny
SESSION_SECRET=votre-cle-secrete-de-plus-de-32-caracteres
GOOGLE_GENERATIVE_AI_API_KEY=votre-cle-api-gemini
GOOGLE_CLIENT_ID=votre-client-id-google (optionnel)
GOOGLE_CLIENT_SECRET=votre-client-secret-google (optionnel)
```

### 4. Lancer le serveur de développement
```bash
npm run dev
```
L'application est disponible sur : **http://localhost:3000**

Comptes de démonstration pré-chargés :
- Email : `alex.morgan@example.com`
- Mot de passe : `saviny-demo-password`

---

## 🧪 Tests & Qualité de code

Le projet dispose d'une suite de tests complète avec **Vitest** et de la validation stricte TypeScript :

```bash
# Vérification des types TypeScript
npm run typecheck

# Exécution des tests automatisés (43 tests unitaires et d'intégration)
npm test

# Build de production pour Vercel
npm run build
```

---

## ☁️ Déploiement sur Vercel

1. Poussez le projet sur GitHub :
   ```bash
   git add .
   git commit -m "feat: complete Saviny PWA and Smart Savings Coach"
   git branch -M main
   git remote add origin https://github.com/<votre-nom>/saviny.git
   git push -u origin main
   ```
2. Importez le projet sur [Vercel](https://vercel.com/new).
3. Ajoutez les variables d'environnement dans le tableau de bord Vercel :
   - `MONGODB_URI` : votre URL de connexion MongoDB Atlas (accessible depuis toutes les IP : `0.0.0.0/0`).
   - `SESSION_SECRET` : chaîne de 32 caractères aléatoires.
   - `GOOGLE_GENERATIVE_AI_API_KEY` : votre clé Google AI Studio.
4. Cliquez sur **Deploy**.

---

## 📁 Architecture du projet

```
saviny/
├── app/                          # Next.js App Router (SSR, Routing par dossier)
│   ├── layout.tsx                # Shell racine PWA avec Service Worker
│   ├── loading.tsx               # Squelette de chargement universel
│   ├── error.tsx                 # Gestionnaire d'erreurs avec reset()
│   ├── actions.ts                # Server Actions ('use server') + MongoDB CRUD
│   ├── items/                    # Server Component SSR (Liste transactions)
│   │   ├── page.tsx
│   │   └── [id]/page.tsx         # Route dynamique SSR [id]
│   ├── assistant/page.tsx        # Page IA utilisant le hook useChat (@ai-sdk/react)
│   ├── offline/page.tsx          # Page de secours hors-ligne (PWA Checklist #5)
│   └── api/                      # Routes d'API Next.js (chat, santé)
│
├── client/                       # Composants UI interactifs (React 19)
│   ├── App.tsx                   # Layout principal de navigation
│   ├── components/
│   │   ├── SmartCoach.tsx        # Avatar flottant & Drawer du Coach Saviny
│   │   ├── WhatIf.tsx            # Simulateur de scénarios financiers IA
│   │   ├── BottomNav.tsx         # Navigation mobile fixe
│   │   ├── SubmitButton.tsx      # Bouton de formulaire avec useFormStatus
│   │   ├── forms.tsx             # Formulaires avec OCR animé et auto-remplissage
│   │   └── PwaPrompt.tsx         # Bannière d'installation PWA
│   ├── pages/                    # Pages de la plateforme (Dashboard, Budgets, etc.)
│   └── lib/                      # Utilitaires (IndexedDB, synchronisation outbox)
│
├── server/                       # Backend et logique métier
│   ├── db/                       # Modèles et collections MongoDB
│   ├── ai/                       # Moteurs IA Gemini (Coach, OCR, What-If, Catégories)
│   └── http/                     # Routeurs d'API et middleware d'authentification
│
├── public/                       # Fichiers statiques et PWA
│   ├── manifest.json             # Manifeste PWA avec icônes maskable
│   ├── sw.js                     # Service Worker PWA (mise en cache & offline)
│   └── icons/                    # Icônes de l'application (192px, 512px)
└── tests/                        # Tests automatisés Vitest
```

---

## 📜 Licence & Auteur
Projet développé dans le cadre du module **Modern Mobile Applications (PWA, Next.js, React 19, MongoDB & AI)**.
Licence MIT.
