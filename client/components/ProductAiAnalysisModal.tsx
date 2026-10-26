import { useState, useEffect } from "react";
import { api } from "../lib/api";
import { formatMoney } from "../lib/format";
import type { Listing } from "../lib/types";
import { Icon } from "./ui";

type ProductReport = {
  listingId: string;
  visualState: string;
  detectedFlaws: string[];
  inconsistencies: string[];
  missingInfo: string[];
  priceVerdict: "deal" | "fair" | "high";
  priceVerdictLabel: string;
  estimatedPriceRange: { min: number; max: number; avg: number };
  priceExplanation: string;
  checklist: string[];
  questionsForSeller: string[];
};

const VERDICT = {
  deal: { label: "Bonne affaire",  color: "#059669", bg: "#ecfdf5", border: "#6ee7b7", badge: "✓" },
  fair: { label: "Prix cohérent",  color: "#2563eb", bg: "#eff6ff", border: "#93c5fd", badge: "✓"  },
  high: { label: "Prix élevé",     color: "#d97706", bg: "#fffbeb", border: "#fcd34d", badge: "•"  },
};

function PriceBar({ price, min, max, avg, currency }: {
  price: number; min: number; max: number; avg: number; currency: string;
}) {
  const range = Math.max(max - min, 1);
  const pct = (v: number) => `${Math.min(100, Math.max(0, ((v - min) / range) * 100)).toFixed(1)}%`;
  return (
    <div className="pr-pricebar">
      <div className="pr-track">
        <div className="pr-fill" style={{ width: pct(avg) }} />
        <div className="pr-pin pr-pin-avg" style={{ left: pct(avg) }} title={`Moy. ${formatMoney(avg, currency)}`} />
        <div className="pr-pin pr-pin-listing" style={{ left: pct(price) }} title={`Annonce ${formatMoney(price, currency)}`} />
      </div>
      <div className="pr-track-labels">
        <span>{formatMoney(min, currency)}</span>
        <span className="pr-muted">Fourchette estimée du marché</span>
        <span>{formatMoney(max, currency)}</span>
      </div>
      <div className="pr-legend">
        <span><span className="pr-dot avg" /> Prix moyen <strong>{formatMoney(avg, currency)}</strong></span>
        <span><span className="pr-dot listing" /> Cette annonce <strong>{formatMoney(price, currency)}</strong></span>
      </div>
    </div>
  );
}

function ProductAiAnalysisModal({
  listing,
  currency,
  onClose,
  onAskSeller,
}: {
  listing: Listing;
  currency: string;
  onClose: () => void;
  onAskSeller: (q: string) => void;
}) {
  const [report, setReport] = useState<ProductReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [checked, setChecked] = useState<Record<number, boolean>>({});
  const [copied, setCopied] = useState<number | null>(null);
  const [scanIdx, setScanIdx] = useState(0);

  const SCAN_STEPS = [
    "Examen des photos et de l'état apparent",
    "Vérification des informations de l'annonce",
    "Comparaison avec les annonces similaires",
  ];

  useEffect(() => {
    if (!loading) return;
    const t = setInterval(() => setScanIdx((i) => Math.min(i + 1, SCAN_STEPS.length - 1)), 1600);
    return () => clearInterval(t);
  }, [loading]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await api<ProductReport>(`/listings/${listing.id}/ai-analyze`, { method: "POST" });
        if (alive) setReport(res);
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : "Impossible d'analyser cette annonce");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [listing.id]);

  const copyQ = (q: string, i: number) => {
    navigator.clipboard?.writeText(q);
    setCopied(i);
    setTimeout(() => setCopied(null), 2000);
  };

  const v = report ? VERDICT[report.priceVerdict] : null;

  return (
    <div className="pr-overlay" onMouseDown={onClose} role="presentation">
      <div
        className="pr-panel"
        role="dialog"
        aria-modal
        aria-label="Évaluation du produit"
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* ── Header ── */}
        <div className="pr-head">
          <div className="pr-head-info">
            {listing.image
              ? <img src={listing.image} className="pr-thumb" alt="" />
              : <div className="pr-thumb-ph"><Icon name="store" size={20} /></div>
            }
            <div>
              <p className="pr-head-title">{listing.title}</p>
              <span className="pr-head-meta">{listing.condition} · {listing.category}</span>
              <strong className="pr-head-price">{formatMoney(listing.price, currency)}</strong>
            </div>
          </div>
          <button className="pr-close" onClick={onClose} aria-label="Fermer">✕</button>
        </div>

        {/* ── Body ── */}
        <div className="pr-body">

          {loading && (
            <div className="pr-scanning">
              <div className="pr-scan-anim">
                <div className="pr-scan-ring" />
                <span className="pr-scan-icon"><Icon name="search" size={20} /></span>
              </div>
              <p className="pr-scan-title">Évaluation en cours…</p>
              <div className="pr-scan-steps">
                {SCAN_STEPS.map((s, i) => (
                  <div key={i} className={`pr-scan-step ${i < scanIdx ? "done" : i === scanIdx ? "active" : ""}`}>
                    <span className="pr-step-dot">{i < scanIdx ? "✓" : ""}</span>
                    <span>{s}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {!loading && error && (
            <div className="pr-err">
              <p>{error}</p>
              <button className="secondary" onClick={onClose}>Fermer</button>
            </div>
          )}

          {!loading && report && v && (
            <div className="pr-report">

              {/* 1 — Verdict */}
              <div className="pr-verdict" style={{ background: v.bg, borderColor: v.border }}>
                <div>
                  <span className="pr-verdict-badge" style={{ background: v.color }}>{v.badge} {v.label}</span>
                  <p className="pr-verdict-explain" style={{ color: v.color }}>{report.priceVerdictLabel}</p>
                  <p className="pr-verdict-detail">{report.priceExplanation}</p>
                </div>
              </div>

              {/* 2 — Price bar */}
              <div className="pr-section">
                <h4 className="pr-section-title">Positionnement du prix</h4>
                <PriceBar
                  price={listing.price}
                  min={report.estimatedPriceRange.min}
                  max={report.estimatedPriceRange.max}
                  avg={report.estimatedPriceRange.avg}
                  currency={currency}
                />
              </div>

              {/* 3 — Visual state */}
              <div className="pr-section">
                <h4 className="pr-section-title">État visuel</h4>
                <p className="pr-visual-state">{report.visualState}</p>
                {report.detectedFlaws.length > 0 && (
                  <div className="pr-tags">
                    {report.detectedFlaws.map((f, i) => {
                      const ok = /aucun|bon état|parfait/i.test(f);
                      return <span key={i} className={`pr-tag ${ok ? "ok" : "warn"}`}>{ok ? "✓" : "•"} {f}</span>;
                    })}
                  </div>
                )}
                {report.inconsistencies.length > 0 && !/aucune/i.test(report.inconsistencies[0]) && (
                  <div className="pr-alert">
                    <strong>À noter :</strong>
                    <ul>{report.inconsistencies.map((inc, i) => <li key={i}>{inc}</li>)}</ul>
                  </div>
                )}
              </div>

              {/* 4 — Missing info */}
              {report.missingInfo.length > 0 && !/aucune/i.test(report.missingInfo[0]) && (
                <div className="pr-section">
                  <h4 className="pr-section-title">Informations manquantes</h4>
                  <div className="pr-tags">
                    {report.missingInfo.map((m, i) => <span key={i} className="pr-tag missing">? {m}</span>)}
                  </div>
                </div>
              )}

              {/* 5 — Checklist */}
              <div className="pr-section">
                <h4 className="pr-section-title">À vérifier avant d'acheter</h4>
                <div className="pr-checklist">
                  {report.checklist.map((item, i) => (
                    <label
                      key={i}
                      className={`pr-check-item ${checked[i] ? "checked" : ""}`}
                      onClick={() => setChecked((p) => ({ ...p, [i]: !p[i] }))}
                    >
                      <span className="pr-checkbox">{checked[i] ? "✓" : ""}</span>
                      <span>{item}</span>
                    </label>
                  ))}
                </div>
              </div>

              {/* 6 — Questions */}
              <div className="pr-section">
                <h4 className="pr-section-title">Questions à poser au vendeur</h4>
                <div className="pr-questions">
                  {report.questionsForSeller.map((q, i) => (
                    <div key={i} className="pr-question">
                      <p className="pr-question-text">« {q} »</p>
                      <div className="pr-question-btns">
                        <button className="pr-btn-copy" onClick={() => copyQ(q, i)}>
                          {copied === i ? "✓ Copié" : "Copier"}
                        </button>
                        <button className="pr-btn-ask" onClick={() => onAskSeller(q)}>
                          Envoyer au vendeur
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <p className="pr-disclaimer">
                Cette évaluation est générée automatiquement à partir des informations de l'annonce.
                Elle ne remplace pas un examen physique du produit.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default ProductAiAnalysisModal;
