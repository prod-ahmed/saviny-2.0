import { randomBytes } from "node:crypto";
import { connectStore } from "../server/database/store";
import { newUser } from "../server/common/domain";
import { hashPassword, newId, nowIso } from "../server/common/security";

/**
 * Adds sample sellers and marketplace listings.
 * Run with `npm run seed`. Safe to run more than once: existing rows are skipped.
 */
const SELLERS = [
  { firstName: "Jordan",  lastName: "Smith",   email: "jordan.smith@example.com",  password: "Demo1234!" },
  { firstName: "Maya",    lastName: "Kim",     email: "maya.kim@example.com",      password: "Demo1234!" },
  { firstName: "Lucas",   lastName: "Moreau",  email: "lucas.moreau@example.com",  password: "Demo1234!" },
  { firstName: "Amira",   lastName: "Ben Ali", email: "amira.benali@example.com",  password: "Demo1234!" },
  { firstName: "Thomas",  lastName: "Dupont",  email: "thomas.dupont@example.com", password: "Demo1234!" },
];

const LISTINGS = [
  // ── Jordan Smith ──────────────────────────────────────────────────────────
  {
    seller: "jordan.smith@example.com",
    title: "Wireless Headphones Sony WH-1000XM4",
    description: "Casque à réduction de bruit active, utilisé un semestre. Excellent état, inclus la housse d'origine et le câble USB-C. Autonomie 30h. Parfait pour le télétravail ou les études.",
    price: 165,
    category: "Electronics",
    condition: "Like new",
    image: "https://images.unsplash.com/photo-1546435770-a3e426bf472b?auto=format&fit=crop&w=600&q=80",
  },
  {
    seller: "jordan.smith@example.com",
    title: "MacBook Pro 13\" 2020 (Intel i5)",
    description: "Processeur Intel Core i5, 8 Go RAM, 256 Go SSD. Batterie à 87% de capacité (89 cycles). Quelques micro-rayures sur le couvercle. Chargeur inclus. Très rapide pour la bureautique et le développement.",
    price: 650,
    category: "Electronics",
    condition: "Good",
    image: "https://images.unsplash.com/photo-1517336714731-489689fd1ca8?auto=format&fit=crop&w=600&q=80",
  },
  {
    seller: "jordan.smith@example.com",
    title: "Vélo de route Trek Domane AL 2",
    description: "Taille M, cadre aluminium, groupe Shimano Sora 18 vitesses. Pneus récents, freins en bon état. Utilisé 2 étés, environ 1 200 km. Idéal pour les trajets quotidiens ou les sorties du week-end.",
    price: 480,
    category: "Sports",
    condition: "Good",
    image: "https://images.unsplash.com/photo-1532298229144-0ec0c57515c7?auto=format&fit=crop&w=600&q=80",
  },

  // ── Maya Kim ──────────────────────────────────────────────────────────────
  {
    seller: "maya.kim@example.com",
    title: "Chaise de bureau ergonomique Herman Miller Aeron",
    description: "Taille B (medium), coloris graphite. Support lombaire ajustable, accoudoirs 4D. Petite griffure sur l'accoudoir gauche, sinon parfait état. Idéale pour les longues sessions de travail.",
    price: 520,
    category: "Home",
    condition: "Good",
    image: "https://images.unsplash.com/photo-1688578735427-994ecdea3ea4?auto=format&fit=crop&w=600&q=80",
  },
  {
    seller: "maya.kim@example.com",
    title: "iPhone 13 128 Go — Minuit",
    description: "Acheté en 2022, débloqué tous opérateurs. Batterie à 91% de capacité (68 cycles). Utilisé avec une coque dès le premier jour. Pas une seule rayure sur l'écran. Vendu sans la coque, inclus chargeur 20W.",
    price: 420,
    category: "Electronics",
    condition: "Like new",
    image: "https://images.unsplash.com/photo-1632661674596-df8be070a5c5?auto=format&fit=crop&w=600&q=80",
  },
  {
    seller: "maya.kim@example.com",
    title: "Appareil photo Fujifilm X-T30 II + objectif 18-55mm",
    description: "Boîtier noir, 26 Mpx, vidéo 4K. 4 200 déclenchements (très faible). Kit complet : deux batteries, chargeur, sangle, carte SD 64 Go SanDisk incluse. Objectif en parfait état optique.",
    price: 780,
    category: "Electronics",
    condition: "Like new",
    image: "https://images.unsplash.com/photo-1526170375885-4d8ecf77b99f?auto=format&fit=crop&w=600&q=80",
  },

  // ── Lucas Moreau ──────────────────────────────────────────────────────────
  {
    seller: "lucas.moreau@example.com",
    title: "Nintendo Switch OLED + 4 jeux",
    description: "Console en parfait état, écran sans rayure. Jeux inclus : Zelda Tears of the Kingdom, Mario Kart 8 Deluxe, Hollow Knight, Stardew Valley. Dock + 2 paires de Joy-Con incluses.",
    price: 310,
    category: "Electronics",
    condition: "Good",
    image: "https://images.unsplash.com/photo-1612287230202-1ff1d85d1bdf?auto=format&fit=crop&w=600&q=80",
  },
  {
    seller: "lucas.moreau@example.com",
    title: "Tapis de yoga Manduka PRO 6mm",
    description: "Couleur bleu marine, 180 x 60 cm. Utilisé une centaine de fois, excellent grip. Lavé et désinfecté. Idéal pour le yoga, le Pilates ou la méditation.",
    price: 55,
    category: "Sports",
    condition: "Good",
    image: "https://images.unsplash.com/photo-1544367567-0f2fcb009e0b?auto=format&fit=crop&w=600&q=80",
  },
  {
    seller: "lucas.moreau@example.com",
    title: "Lampe de bureau LED Anglepoise Type 75",
    description: "Finition noir mat, ampoule LED 7W incluse (2700K). Quelques légères marques sur le bras articulé. Fonctionne parfaitement. Câble textile d'origine.",
    price: 70,
    category: "Home",
    condition: "Good",
    image: "https://images.unsplash.com/photo-1507473885765-e6ed057f782c?auto=format&fit=crop&w=600&q=80",
  },

  // ── Amira Ben Ali ─────────────────────────────────────────────────────────
  {
    seller: "amira.benali@example.com",
    title: "Sac à dos Herschel Little America 25L",
    description: "Coloris noir, compartiment laptop 15\". Utilisé deux ans, fermoirs et fermetures éclair en bon état. Légère usure sur le fond. Très résistant et spacieux.",
    price: 40,
    category: "Fashion",
    condition: "Fair",
    image: "https://images.unsplash.com/photo-1553062407-98eeb64c6a62?auto=format&fit=crop&w=600&q=80",
  },
  {
    seller: "amira.benali@example.com",
    title: "Table basse scandinave IKEA LACK",
    description: "Couleur chêne blanchi, 90 x 55 cm. Très bon état, pas de rayures visibles. Facilement démontable. À récupérer sur place.",
    price: 25,
    category: "Home",
    condition: "Good",
    image: "https://images.unsplash.com/photo-1555041469-a586c61ea9bc?auto=format&fit=crop&w=600&q=80",
  },

  // ── Thomas Dupont ─────────────────────────────────────────────────────────
  {
    seller: "thomas.dupont@example.com",
    title: "Imprimante laser HP LaserJet Pro M404dn",
    description: "Réseau câblé, impression recto-verso automatique. 3 200 pages imprimées (faible). Cartouche à 60%. Parfaite pour le bureau à domicile.",
    price: 90,
    category: "Electronics",
    condition: "Good",
    image: "https://images.unsplash.com/photo-1612198790700-0c3a5e1e3e9a?auto=format&fit=crop&w=600&q=80",
  },
  {
    seller: "thomas.dupont@example.com",
    title: "Guitare acoustique Yamaha F310",
    description: "Table en épicéa, fond et éclisses en nato. Cordes récemment changées. Quelques marques de médiator sur la table. Livrée avec housse souple et médiators.",
    price: 95,
    category: "Other",
    condition: "Good",
    image: "https://images.unsplash.com/photo-1510915361894-db8b60106cb1?auto=format&fit=crop&w=600&q=80",
  },
  {
    seller: "thomas.dupont@example.com",
    title: "Cafetière à piston Bodum Chambord 8 tasses",
    description: "Inox brossé, verre borosilicaté. Utilisée environ 300 fois. Nettoyée à fond. Inclut les filtres de rechange. Idéale pour un café artisanal.",
    price: 28,
    category: "Home",
    condition: "Like new",
    image: "https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?auto=format&fit=crop&w=600&q=80",
  },

  // ── Fashion — état variable (pour tester le scan IA) ─────────────────────
  {
    seller: "amira.benali@example.com",
    title: "Veste en jean Levi's 501 — Délavée",
    description: "Taille L. Portée des centaines de fois, nombreuses décolorations et effilochages aux manches. Trous visibles aux poches. Style vintage assumé mais clairement usée. Boutons d'origine.",
    price: 12,
    category: "Fashion",
    condition: "Fair",
    image: "https://images.unsplash.com/photo-1551537482-f2075a1d41f2?auto=format&fit=crop&w=600&q=80",
  },
  {
    seller: "lucas.moreau@example.com",
    title: "Baskets Nike Air Max 90 — Taille 43",
    description: "Portées pendant 2 ans en usage quotidien. Semelle très usée, jaunissement prononcé. Taches sur l'empeigne, un lacet remplacé. À vendre en l'état, non nettoyées.",
    price: 18,
    category: "Fashion",
    condition: "Fair",
    image: "https://images.unsplash.com/photo-1542291026-7eec264c27ff?auto=format&fit=crop&w=600&q=80",
  },
  {
    seller: "jordan.smith@example.com",
    title: "Manteau laine H&M — Camel — Taille S",
    description: "Porté deux hivers. Bouloches importantes sur tout le tissu. Couture intérieure partiellement décousue. Doublure tachée. Fermeture éclair fonctionnelle.",
    price: 10,
    category: "Fashion",
    condition: "Fair",
    image: "https://images.unsplash.com/photo-1539533018447-63fcce2678e3?auto=format&fit=crop&w=600&q=80",
  },
  {
    seller: "maya.kim@example.com",
    title: "Robe d'été Zara fleurie — Taille M",
    description: "Portée une saison, très bon état général. Légère trace de déodorant sous un bras, sinon impeccable. Tissu fluide, motif floral. Lavée et repassée.",
    price: 15,
    category: "Fashion",
    condition: "Good",
    image: "https://images.unsplash.com/photo-1515372039744-b8f02a3ae446?auto=format&fit=crop&w=600&q=80",
  },
  {
    seller: "thomas.dupont@example.com",
    title: "Pull en laine mérinos Uniqlo — Taille M",
    description: "Excellent état, porté quelques fois seulement. Aucun bouloche. Coloris gris chiné. Parfait pour l'automne.",
    price: 22,
    category: "Fashion",
    condition: "Like new",
    image: "https://images.unsplash.com/photo-1434389677669-e08b4cac3105?auto=format&fit=crop&w=600&q=80",
  },
  {
    seller: "amira.benali@example.com",
    title: "Sneakers Adidas Stan Smith — Taille 38",
    description: "Portées une dizaine de fois. Blanc toujours très propre, semelle nette. Lacets d'origine. Boîte non disponible.",
    price: 45,
    category: "Fashion",
    condition: "Like new",
    image: "https://images.unsplash.com/photo-1603808033192-082d6919d3e1?auto=format&fit=crop&w=600&q=80",
  },
  {
    seller: "lucas.moreau@example.com",
    title: "Costume Hugo Boss slim fit — Taille 48",
    description: "Costume deux pièces gris anthracite, porté deux fois pour des entretiens. Comme neuf. Pantalon avec ourlet. Nettoyé à sec.",
    price: 120,
    category: "Fashion",
    condition: "Like new",
    image: "https://images.unsplash.com/photo-1507679799987-c73779587ccf?auto=format&fit=crop&w=600&q=80",
  },

  // ── Jeans & Denim (pour tester la recherche et l'analyse visuelle) ───────
  {
    seller: "jordan.smith@example.com",
    title: "Jeans Levi's 501 Original brut — W32 L32",
    description: "Toile denim selvedge 100% coton, coupe droite classique légendaire. Très peu porté, couleur indigo foncé uniforme. Aucun accroc ni usure sur l'entrejambe ou les ourlets. Boutons métalliques Levi's impeccables.",
    price: 45,
    category: "Clothing",
    condition: "Like new",
    image: "https://images.unsplash.com/photo-1542272604-787c3835535d?auto=format&fit=crop&w=600&q=80",
  },
  {
    seller: "amira.benali@example.com",
    title: "Jeans Zara slim déchiré — Style vintage délavé",
    description: "Jeans bleu clair avec déchirures franches aux deux genoux et effilochages sur les poches avant. Porté souvent, tissu très souple et patiné. Fermeture éclair fonctionnelle.",
    price: 14,
    category: "Clothing",
    condition: "Fair",
    image: "https://images.unsplash.com/photo-1582552938357-32b906df40cb?auto=format&fit=crop&w=600&q=80",
  },
  {
    seller: "thomas.dupont@example.com",
    title: "Jeans slim noir Tommy Hilfiger — Taille 31",
    description: "Denim stretch noir confortable. Porté un an, couleur légèrement passée aux coutures et poches mais sans trou ni tâche. Patch cuir arrière en parfait état.",
    price: 28,
    category: "Clothing",
    condition: "Good",
    image: "https://images.unsplash.com/photo-1541099649105-f69ad21f3246?auto=format&fit=crop&w=600&q=80",
  },
  {
    seller: "lucas.moreau@example.com",
    title: "Jeans coupe droite Levi's délavé bleu",
    description: "Coupe classique confortable, délavage moyen. Bon état général, tissu solide sans trou. Légère trace de pliure au bas de jambe.",
    price: 22,
    category: "Clothing",
    condition: "Good",
    image: "https://images.unsplash.com/photo-1576995853123-5a10305d93c0?auto=format&fit=crop&w=600&q=80",
  },
];

const uri      = process.env.MONGODB_URI ?? "mongodb://127.0.0.1:27017";
const database = process.env.MONGODB_DB  ?? "saviny";

async function main(): Promise<void> {
  const store = await connectStore(uri, database);
  try {
    const userIds = new Map<string, string>();

    for (const seller of SELLERS) {
      const existing = await store.one("users", { email: seller.email });
      if (existing) {
        userIds.set(seller.email, existing.id);
        console.log(`  ↩  User already exists: ${seller.email}`);
        continue;
      }
      const user = newUser({
        firstName: seller.firstName,
        lastName:  seller.lastName,
        email:     seller.email,
        passwordHash: await hashPassword(seller.password ?? randomBytes(32).toString("base64url")),
        role: "member",
      });
      await store.insert("users", user);
      userIds.set(seller.email, user.id);
      console.log(`  ✓  Created user: ${seller.email}  (password: ${seller.password})`);
    }

    let added = 0;
    for (const item of LISTINGS) {
      const userId = userIds.get(item.seller)!;
      if (await store.one("listings", { user_id: userId, title: item.title })) {
        console.log(`  ↩  Listing already exists: "${item.title}"`);
        continue;
      }
      const id = newId();
      await store.insert("listings", {
        id, user_id: userId, title: item.title, description: item.description,
        price: item.price, category: item.category, condition: item.condition,
        status: "available", created_at: nowIso(),
      });
      await store.insert("listing_photos", { listing_id: id, position: 0, url: item.image });
      console.log(`  ✓  Added listing: "${item.title}" (${item.price} — ${item.seller})`);
      added += 1;
    }

    console.log(`\nSeed complete: ${userIds.size} users, ${added} listings added → ${uri}/${database}`);
    console.log("\nTest accounts (password: Demo1234!):");
    for (const s of SELLERS) console.log(`  ${s.email}`);
  } finally {
    await store.close();
  }
}

await main();
