import { useState, useEffect } from "react";
import { Icon, type IconName } from "./ui";

interface OnboardingDemoProps {
  isOpen: boolean;
  onClose: () => void;
  onNavigate?: (path: string) => void;
}

interface TourPoint {
  iconName?: IconName;
  tag?: string;
  title: string;
  desc: string;
}

interface TourSlide {
  badge: string;
  title: string;
  subtitle: string;
  avatarSrc?: string;
  points: TourPoint[];
  actionText: string;
}

const SLIDES: TourSlide[] = [
  {
    badge: "Bienvenue sur Pennywise",
    title: "Gestion Financière & Épargne Intelligente",
    subtitle: "Une application financière moderne, conçue pour vous donner le contrôle total de votre budget.",
    avatarSrc: "/assets/pennywise-logo.png",
    points: [
      {
        iconName: "grid",
        title: "Vue d'ensemble centralisée",
        desc: "Suivez vos soldes, vos dépenses mensuelles, vos budgets et vos échéances en un coup d'œil.",
      },
      {
        iconName: "wallet",
        title: "PWA Mobile-First & Hors-Ligne",
        desc: "Accessible partout, même sans connexion réseau, avec synchronisation automatique au retour d'internet.",
      },
      {
        iconName: "settings",
        title: "Confidentialité & Sécurité",
        desc: "Vos données financières privées sont conservées de manière étanche dans votre base sécurisée.",
      },
    ],
    actionText: "Découvrir Coach Penny",
  },
  {
    badge: "Coach d'Épargne Personnel",
    title: "Penny — Smart Savings Coach",
    subtitle: "Votre conseillère financière interactive pour optimiser vos réserves et sécuriser vos projets.",
    avatarSrc: "/assets/penny-avatar-thumb.png",
    points: [
      {
        iconName: "target",
        title: "Capacité d'épargne en temps réel",
        desc: "Penny calcule votre flux net réel (revenus - charges) et propose un rythme hebdomadaire adapté.",
      },
      {
        iconName: "budget",
        title: "Surveillance de vos objectifs",
        desc: "Détection préventive des retards sur vos échéances avec conseils de rééquilibrage budgétaire.",
      },
      {
        iconName: "sparkle",
        title: "Accessible à tout moment",
        desc: "Cliquez sur l'avatar Penny en bas à droite pour ouvrir votre diagnostic financier ou poser une question.",
      },
    ],
    actionText: "Voir la Numérisation de Reçus",
  },
  {
    badge: "Numérisation Assistée",
    title: "Scanner de Reçus par Vision Optique",
    subtitle: "Enregistrez vos achats en quelques secondes sans saisie manuelle.",
    points: [
      {
        iconName: "swap",
        title: "Extraction optique automatisée",
        desc: "Photographiez votre ticket de caisse : l'analyse extrait immédiatement le montant exact, la date et les détails.",
      },
      {
        iconName: "saving",
        title: "Catégorisation intelligente",
        desc: "Penny associe directement la transaction à la bonne catégorie budgétaire pour un suivi sans friction.",
      },
      {
        iconName: "check",
        title: "Contrôle avant validation",
        desc: "Les champs préremplis restent modifiables avant confirmation et enregistrement définitif.",
      },
    ],
    actionText: "Voir le Simulateur What-If",
  },
  {
    badge: "Modélisation Prévisionnelle",
    title: "Simulateur de Scénarios (What-If)",
    subtitle: "Anticipez l'impact de chaque décision avant de modifier vos habitudes de dépenses.",
    points: [
      {
        iconName: "budget",
        title: "Hypothèses financières personnalisées",
        desc: "Hausse de loyer, revalorisation salariale, résiliation d'abonnements : testez des hypothèses concrètes.",
      },
      {
        iconName: "target",
        title: "Projection sur vos dates cibles",
        desc: "Visualisez en direct si un projet d'épargne est décalé ou accéléré selon vos arbitrages.",
      },
      {
        iconName: "more",
        title: "Recommandations d'accompagnement",
        desc: "Penny formule des étapes pratiques pour absorber les variations de trésorerie.",
      },
    ],
    actionText: "Commencer à utiliser Pennywise",
  },
];

export function OnboardingDemo({ isOpen, onClose }: OnboardingDemoProps) {
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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-fadeIn">
      <div
        className="bg-white dark:bg-[#11201f] w-full max-w-lg rounded-2xl shadow-xl border border-slate-200 dark:border-slate-800 overflow-hidden flex flex-col max-h-[90vh] text-[#102a29] dark:text-emerald-50"
        role="dialog"
        aria-modal="true"
        aria-label="Guide de découverte Pennywise"
      >
        {/* Header */}
        <div className="px-5 py-4 flex items-center justify-between border-b border-slate-100 dark:border-slate-800">
          <div className="flex items-center gap-3">
            <img
              src="/assets/pennywise-logo.png"
              alt="Pennywise"
              className="w-8 h-8 rounded-full border border-slate-200 object-cover bg-white"
            />
            <div>
              <div className="flex items-center gap-2">
                <span className="font-bold text-sm tracking-tight text-slate-900 dark:text-white">Pennywise</span>
                <span className="text-[10px] font-semibold px-2 py-0.2 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                  Guide d'utilisation
                </span>
              </div>
              <p className="text-[11px] text-slate-400">Étape {currentStep + 1} sur {SLIDES.length}</p>
            </div>
          </div>
          <button
            onClick={handleSkip}
            className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition"
            aria-label="Fermer"
          >
            ✕
          </button>
        </div>

        {/* Segmented Progress Line */}
        <div className="w-full bg-slate-100 dark:bg-slate-800 h-1 flex">
          {SLIDES.map((_, i) => (
            <div
              key={i}
              className={`h-full flex-1 transition-all duration-300 ${
                i <= currentStep ? "bg-emerald-600" : "bg-transparent"
              }`}
            />
          ))}
        </div>

        {/* Modal Body */}
        <div className="p-6 overflow-y-auto space-y-4">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1">
              <span className="inline-block text-[10px] font-semibold uppercase tracking-wider text-emerald-800 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950 px-2 py-0.5 rounded border border-emerald-200 dark:border-emerald-800">
                {slide.badge}
              </span>
              <h3 className="text-lg font-bold text-slate-900 dark:text-white leading-tight">
                {slide.title}
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                {slide.subtitle}
              </p>
            </div>
            {slide.avatarSrc && (
              <img
                src={slide.avatarSrc}
                alt="Illustration"
                className="w-14 h-14 rounded-full object-cover border border-slate-200 shrink-0 shadow-sm"
              />
            )}
          </div>

          {/* Key Feature Points */}
          <div className="space-y-2.5 pt-1">
            {slide.points.map((pt, idx) => (
              <div
                key={idx}
                className="flex items-start gap-3 p-3 rounded-xl bg-slate-50 dark:bg-slate-900/60 border border-slate-100 dark:border-slate-800"
              >
                <div className="w-7 h-7 rounded-lg bg-white dark:bg-slate-800 flex items-center justify-center shrink-0 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200">
                  {pt.iconName ? <Icon name={pt.iconName} size={15} /> : <span className="text-xs font-bold">•</span>}
                </div>
                <div>
                  <h4 className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                    {pt.title}
                  </h4>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 leading-relaxed">
                    {pt.desc}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Footer Navigation */}
        <div className="p-4 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between gap-3 bg-slate-50/50 dark:bg-slate-900/30">
          <button
            onClick={handleSkip}
            className="text-xs font-medium text-slate-500 hover:text-slate-800 dark:text-slate-400 px-3 py-1.5 transition"
          >
            Passer
          </button>

          <div className="flex items-center gap-2">
            {currentStep > 0 && (
              <button
                onClick={handlePrev}
                className="px-3.5 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition"
              >
                Précédent
              </button>
            )}
            <button
              onClick={handleNext}
              className="px-4 py-2 rounded-lg bg-[#0e2422] hover:bg-[#153430] text-white text-xs font-semibold shadow-sm transition flex items-center gap-1.5 cursor-pointer"
            >
              <span>{slide.actionText}</span>
              <span>→</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
