import { useCallback, useEffect, useState } from "react";

interface OnboardingDemoProps {
  isOpen: boolean;
  onClose: () => void;
  onNavigate: (path: string) => void;
  userId?: string;
}

const TOUR_STEPS = [
  {
    path: "/dashboard",
    comment: "Welcome! Your dashboard brings together your accounts, spending, and budgets.",
  },
  {
    path: "/transactions",
    comment: "Track transactions or add one by scanning a receipt.",
  },
  {
    path: "/marketplace",
    comment: "Browse listings and ask Penny for an AI price estimate.",
  },
  {
    path: "/dashboard",
    comment: "I’m here to help. Open my avatar to talk about your budget and savings.",
  },
] as const;

const STEP_DURATION_MS = 5_000;

export function OnboardingDemo({ isOpen, onClose, onNavigate, userId }: OnboardingDemoProps) {
  const [currentStep, setCurrentStep] = useState(0);
  const storageKey = userId ? `pennywise_tour_completed_${userId}` : "pennywise_tour_completed";

  const finishTour = useCallback(() => {
    try {
      localStorage.setItem(storageKey, "true");
    } catch (error) {
      console.error("Could not save Pennywise onboarding status.", error);
    }
    onClose();
  }, [onClose, storageKey]);

  useEffect(() => {
    if (!isOpen) return;

    onNavigate(TOUR_STEPS[currentStep].path);
    const timer = window.setTimeout(() => {
      if (currentStep < TOUR_STEPS.length - 1) setCurrentStep((step) => step + 1);
      else finishTour();
    }, STEP_DURATION_MS);

    return () => window.clearTimeout(timer);
  }, [currentStep, finishTour, isOpen, onNavigate]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") finishTour();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [finishTour, isOpen]);

  if (!isOpen) return null;

  return (
    <aside
      className="fixed bottom-24 right-4 z-50 w-72 max-w-[calc(100vw-2rem)] animate-fadeIn sm:right-6"
      role="status"
      aria-live="polite"
      aria-label="Pennywise guided tour"
    >
      <div className="rounded-2xl rounded-br-sm border border-stone-200 bg-[#f8faf9] p-3.5 text-[#102a29] shadow-lg">
        <div className="mb-1.5 flex items-center justify-between gap-2">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-[#4e8a90]">
            Penny · {currentStep + 1}/{TOUR_STEPS.length}
          </span>
          <button
            type="button"
            onClick={finishTour}
            className="rounded p-1 text-stone-400 transition hover:text-stone-700"
            aria-label="Skip the guided tour"
            title="Skip tour"
          >
            ✕
          </button>
        </div>
        <p className="text-xs leading-relaxed text-stone-700">{TOUR_STEPS[currentStep].comment}</p>
        <div className="mt-2 flex gap-1" aria-hidden="true">
          {TOUR_STEPS.map((_, index) => (
            <span
              key={index}
              className={`h-1 rounded-full transition-all ${index === currentStep ? "w-5 bg-[#74b5bd]" : "w-2 bg-stone-300"}`}
            />
          ))}
        </div>
      </div>
    </aside>
  );
}
