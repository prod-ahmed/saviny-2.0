import { useState, useEffect } from "react";
import { Icon } from "./ui";

interface OnboardingDemoProps {
  isOpen: boolean;
  onClose: () => void;
  onNavigate?: (path: string) => void;
}

const SLIDES = [
  {
    badge: "Bienvenue sur Pennywise",
    badgeColor: "bg-emerald-100 text-emerald-800 border-emerald-300",
    title: "Votre Compagnon Financier Intelligent",
    subtitle: "Maîtrisez vos finances avec une PWA ultra-rapide et l'intelligence artificielle.",
    icon: "🌱",
    image: "/assets/pennywise-logo.png",
    points: [
      {
        icon: "💳",
        title: "Tableau de bord unifié",
        desc: "Visualisez en un coup d'œil vos soldes, dépenses du mois, budgets et prochains paiements.",
      },
      {
        icon: "📱",
        title: "PWA Mobile-First & Hors-Ligne",
        desc: "Installez Pennywise sur votre écran d'accueil. L'application continue de fonctionner même en mode avion.",
      },
      {
        icon: "🔒",
        title: "Confidentialité garantie",
        desc: "Vos données restent stockées dans votre espace privé MongoDB sécurisé.",
      },
    ],
    actionText: "Découvrir l'IA Pennywise →",
  },
  {
    badge: "✨ IA n°1 : Smart Savings Coach",
    badgeColor: "bg-amber-100 text-amber-900 border-amber-300",
    title: "Votre Coach d'Épargne Personnel",
    subtitle: "Un conseiller financier bienveillant toujours à portée de clic.",
    icon: "🧙‍♂️",
    points: [
      {
        icon: "⚡",
        title: "Calcul de votre Capacité d'Épargne",
        desc: "Le Coach analyse vos revenus et vos charges pour déterminer précisément combien vous pouvez épargner chaque mois.",
      },
      {
        icon: "🎯",
        title: "Surveillance de vos Objectifs",
        desc: "Détection préventive des retards sur vos projets d'épargne avec suggestions de coupes de dépenses indolores.",
      },
      {
        icon: "💬",
        title: "Avatar toujours disponible",
        desc: "Cliquez sur l'avatar du Coach en bas à droite de l'écran pour obtenir un diagnostic instantané.",
      },
    ],
    actionText: "Voir le Scanner OCR →",
  },
  {
    badge: "✨ IA n°2 : Vision & OCR Reçus",
    badgeColor: "bg-indigo-100 text-indigo-900 border-indigo-300",
    title: "Scanner de Reçus Intelligent",
    subtitle: "Dites adieu à la saisie manuelle de vos tickets de caisse !",
    icon: "📷",
    points: [
      {
        icon: "✨",
        title: "Scan Laser Multimodal",
        desc: "Prenez une photo de votre ticket : admirez le balayage laser en direct et l'analyse visuelle en temps réel.",
      },
      {
        icon: "🪄",
        title: "Remplissage Automatique à 100%",
        desc: "Le montant exact, la date, les articles et même le compte débité sont renseignés automatiquement.",
      },
      {
        icon: "🏷️",
        title: "Catégorisation Intelligente",
        desc: "L'IA associe directement la bonne catégorie (Alimentation, Transport, Shopping...) sans effort.",
      },
    ],
    actionText: "Voir le Simulateur What-If →",
  },
  {
    badge: "✨ IA n°3 : Simulateur 'What-If'",
    badgeColor: "bg-purple-100 text-purple-900 border-purple-300",
    title: "Simulez le Futur de vos Finances",
    subtitle: "Testez l'impact de chaque décision avant de la prendre.",
    icon: "🔮",
    points: [
      {
        icon: "📈",
        title: "Scénarios Préréglés",
        desc: "Hausse de loyer, augmentation de salaire, résiliation d'abonnements... testez en un clic.",
      },
      {
        icon: "⏱️",
        title: "Impact Direct sur vos Objectifs",
        desc: "Voyez immédiatement si votre projet vacances ou apport immobilier prend 3 mois d'avance ou de retard.",
      },
      {
        icon: "💡",
        title: "Conseils Actionnables",
        desc: "Le Coach vous donne la marche à suivre concrète pour amortir tout imprévu financier.",
      },
    ],
    actionText: "Voir les PWA & Fonctionnalités →",
  },
  {
    badge: "🚀 Prêt à démarrer",
    badgeColor: "bg-emerald-100 text-emerald-900 border-emerald-300",
    title: "Vous êtes prêt pour Pennywise !",
    subtitle: "Commencez dès maintenant à reprendre le contrôle total de votre argent.",
    icon: "💎",
    points: [
      {
        icon: "📲",
        title: "Installez l'application",
        desc: "Cliquez sur 'Installer l'application' dans le menu pour l'ajouter à votre écran d'accueil.",
      },
      {
        icon: "💡",
        title: "Boutons IA partout",
        desc: "Repérez les badges '✨ IA' dans Transactions, Budgets, Factures et Objectifs pour vous faire assister.",
      },
      {
        icon: "🔄",
        title: "Revisiter ce guide",
        desc: "Vous pouvez rouvrir ce guide à tout moment via le bouton '✨ Guide & Démo' dans la barre supérieure.",
      },
    ],
    actionText: "C'est parti ! 🚀",
  },
];

export function OnboardingDemo({ isOpen, onClose, onNavigate }: OnboardingDemoProps) {
  const [currentStep, setCurrentStep] = useState(0);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isOpen) return;
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight" && currentStep < SLIDES.length - 1) setCurrentStep((s) => s + 1);
      if (e.key === "ArrowLeft" && currentStep > 0) setCurrentStep((s) => s - 1);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, currentStep, onClose]);

  if (!isOpen) return null;

  const slide = SLIDES[currentStep];

  const handleNext = () => {
    if (currentStep < SLIDES.length - 1) {
      setCurrentStep((s) => s + 1);
    } else {
      localStorage.setItem("pennywise_tour_seen", "true");
      onClose();
    }
  };

  const handlePrev = () => {
    if (currentStep > 0) setCurrentStep((s) => s - 1);
  };

  const handleSkip = () => {
    localStorage.setItem("pennywise_tour_seen", "true");
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fadeIn">
      <div
        className="bg-white dark:bg-[#152322] w-full max-w-xl rounded-3xl shadow-2xl border border-emerald-100 dark:border-emerald-900/40 overflow-hidden flex flex-col max-h-[92vh] animate-scaleUp text-[#102a29] dark:text-emerald-50"
        role="dialog"
        aria-modal="true"
        aria-label="Guide de découverte Pennywise"
      >
        {/* Header with Logo and Close */}
        <div className="p-5 pb-3 flex items-center justify-between border-b border-gray-100 dark:border-gray-800">
          <div className="flex items-center gap-3">
            <img
              src="/assets/pennywise-logo.png"
              alt="Pennywise"
              className="w-10 h-10 rounded-full shadow-md border-2 border-emerald-400 object-cover bg-white"
            />
            <div>
              <div className="flex items-center gap-2">
                <span className="font-extrabold text-base tracking-tight text-emerald-950 dark:text-white">Pennywise</span>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border border-emerald-500/20">
                  Démo interactive
                </span>
              </div>
              <p className="text-[11px] text-gray-500 dark:text-gray-400">Étape {currentStep + 1} sur {SLIDES.length}</p>
            </div>
          </div>
          <button
            onClick={handleSkip}
            className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 p-2 rounded-xl hover:bg-gray-100 dark:hover:bg-gray-800 transition"
            aria-label="Fermer le guide"
          >
            ✕
          </button>
        </div>

        {/* Step Progress Bar */}
        <div className="w-full bg-gray-100 dark:bg-gray-800 h-1.5 flex">
          {SLIDES.map((_, i) => (
            <div
              key={i}
              className={`h-full flex-1 transition-all duration-300 ${
                i <= currentStep ? "bg-emerald-500" : "bg-transparent"
              } ${i === currentStep ? "opacity-100" : "opacity-60"}`}
            />
          ))}
        </div>

        {/* Modal Body */}
        <div className="p-6 overflow-y-auto space-y-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <span className={`inline-block text-[11px] font-bold px-3 py-1 rounded-full border mb-2 ${slide.badgeColor}`}>
                {slide.badge}
              </span>
              <h3 className="text-xl sm:text-2xl font-black text-gray-900 dark:text-white leading-tight">
                {slide.title}
              </h3>
              <p className="text-sm text-gray-600 dark:text-gray-300 mt-1">
                {slide.subtitle}
              </p>
            </div>
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-emerald-100 to-teal-50 dark:from-emerald-900/50 dark:to-teal-900/30 flex items-center justify-center text-3xl shadow-inner shrink-0 border border-emerald-200/60 dark:border-emerald-700/40">
              {slide.icon}
            </div>
          </div>

          {/* Key Feature Points */}
          <div className="space-y-3 pt-2">
            {slide.points.map((pt, idx) => (
              <div
                key={idx}
                className="flex items-start gap-3.5 p-3.5 rounded-2xl bg-gray-50/80 dark:bg-emerald-950/20 border border-gray-100 dark:border-emerald-900/30 hover:border-emerald-300 dark:hover:border-emerald-700 transition"
              >
                <div className="w-9 h-9 rounded-xl bg-white dark:bg-emerald-900/40 flex items-center justify-center text-lg shrink-0 shadow-sm border border-gray-200/50 dark:border-gray-700/50">
                  {pt.icon}
                </div>
                <div>
                  <h4 className="text-xs sm:text-sm font-bold text-gray-900 dark:text-emerald-100">
                    {pt.title}
                  </h4>
                  <p className="text-xs text-gray-600 dark:text-gray-300 mt-0.5 leading-relaxed">
                    {pt.desc}
                  </p>
                </div>
              </div>
            ))}
          </div>

          {/* Quick preview card on slide 0 */}
          {currentStep === 0 && (
            <div className="p-4 rounded-2xl bg-gradient-to-r from-emerald-700 to-teal-900 text-white flex items-center gap-4 shadow-lg">
              <img
                src="/assets/pennywise-logo.png"
                alt="Pennywise"
                className="w-14 h-14 rounded-full border-2 border-white/50 bg-white p-0.5 shrink-0 object-cover shadow"
              />
              <div>
                <p className="text-xs font-semibold text-emerald-200 uppercase tracking-wider">Astuce Pro</p>
                <p className="text-xs text-white/90 mt-0.5">
                  Toutes les fonctionnalités IA (Scanner, Coach, Simulateur) sont alimentées par <strong>Google Gemini Flash</strong> pour des réponses instantanées.
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Footer Navigation */}
        <div className="p-5 pt-3 border-t border-gray-100 dark:border-gray-800 flex items-center justify-between gap-3 bg-gray-50/50 dark:bg-emerald-950/10">
          <button
            onClick={handleSkip}
            className="text-xs font-semibold text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200 px-3 py-2 rounded-xl transition"
          >
            Passer le guide
          </button>

          <div className="flex items-center gap-2">
            {currentStep > 0 && (
              <button
                onClick={handlePrev}
                className="px-4 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 text-xs font-bold text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 transition"
              >
                Précédent
              </button>
            )}
            <button
              onClick={handleNext}
              className="px-5 py-2.5 rounded-xl bg-[#102a29] dark:bg-emerald-600 text-white text-xs font-bold shadow-md hover:bg-[#1a3f3e] dark:hover:bg-emerald-500 transition flex items-center gap-1.5"
            >
              <span>{slide.actionText}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
