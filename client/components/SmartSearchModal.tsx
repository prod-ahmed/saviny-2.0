import { useState, useRef, useCallback } from "react";
import { Icon } from "../components/ui";
import { api } from "../lib/api";
import { formatMoney } from "../lib/format";
import { LISTING_CATEGORIES } from "../components/forms";
import type { Listing } from "../lib/types";

interface DetectedObject { label: string; confidence: number; }
interface SmartResult extends Listing { similarity: number; }

const CONDITIONS = ["New", "Like new", "Good", "Fair"];

function compressImage(file: File, maxDim = 1200, quality = 0.85): Promise<string> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        if (width > maxDim || height > maxDim) {
          if (width > height) { height = Math.round((height * maxDim) / width); width = maxDim; }
          else { width = Math.round((width * maxDim) / height); height = maxDim; }
        }
        const canvas = document.createElement("canvas");
        canvas.width = width; canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (!ctx) return resolve(String(e.target?.result));
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.onerror = () => resolve(String(e.target?.result));
      img.src = String(e.target?.result);
    };
    reader.onerror = () => resolve("");
    reader.readAsDataURL(file);
  });
}

function SmartSearchModal({
  onClose,
  onNavigate,
  currency,
}: {
  onClose: () => void;
  onNavigate: (id: string) => void;
  currency: string;
}) {
  const [step, setStep] = useState<"pick" | "scanning" | "select" | "searching" | "results">("pick");
  const [mode, setMode] = useState<"photo" | "text">("photo");
  const [preview, setPreview] = useState<string | null>(null);
  const [imageData, setImageData] = useState<string | null>(null);
  const [textQuery, setTextQuery] = useState("");
  const [detected, setDetected] = useState<DetectedObject[]>([]);
  const [selectedLabel, setSelectedLabel] = useState<string | null>(null);
  const [results, setResults] = useState<SmartResult[]>([]);
  const [filterCategory, setFilterCategory] = useState("");
  const [filterMax, setFilterMax] = useState("");
  const [filterCondition, setFilterCondition] = useState("");
  const [error, setError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const dropRef = useRef<HTMLDivElement>(null);

  const reset = () => {
    setStep("pick"); setResults([]); setPreview(null);
    setImageData(null); setSelectedLabel(null); setDetected([]);
    setFilterCategory(""); setFilterMax(""); setFilterCondition(""); setError("");
  };

  const handleFile = useCallback(async (file: File) => {
    setError("");
    setStep("scanning");
    try {
      const dataUrl = await compressImage(file);
      if (!dataUrl) throw new Error("Impossible de lire l'image");
      setPreview(dataUrl);
      setImageData(dataUrl);
      const res = await api<{ objects: DetectedObject[] }>("/listings/search/detect", {
        method: "POST", json: { image: dataUrl },
      });
      setDetected(res.objects);
      if (res.objects.length === 1) {
        setSelectedLabel(res.objects[0].label);
        await runSearch({ query: res.objects[0].label, image: dataUrl });
      } else if (res.objects.length === 0) {
        await runSearch({ query: "article", image: dataUrl });
      } else {
        setStep("select");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Analyse impossible");
      setStep("pick");
    }
  }, []);

  const runSearch = useCallback(async (payload: {
    query: string; image?: string; category?: string; maxPrice?: string; condition?: string;
  }) => {
    setStep("searching");
    setError("");
    try {
      const res = await api<{ results: SmartResult[] }>("/listings/search/visual", {
        method: "POST", json: payload,
      });
      setResults(res.results);
      setStep("results");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Recherche impossible");
      setStep(imageData ? "select" : "pick");
    }
  }, [imageData]);

  const applyFilters = () => {
    const query = selectedLabel ?? textQuery;
    runSearch({ query, image: imageData ?? undefined, category: filterCategory || undefined, maxPrice: filterMax || undefined, condition: filterCondition || undefined });
  };

  const visibleResults = results.filter((r) => {
    if (filterCategory && r.category !== filterCategory) return false;
    if (filterMax && r.price > Number(filterMax)) return false;
    if (filterCondition && r.condition !== filterCondition) return false;
    return true;
  });

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file?.type.startsWith("image/")) handleFile(file);
  };

  return (
    <div className="ss-overlay" role="presentation" onMouseDown={onClose}>
      <div className="ss-panel" role="dialog" aria-modal="true" aria-label="Recherche avancée" onMouseDown={(e) => e.stopPropagation()}>

        {/* ── Header ── */}
        <div className="ss-head">
          <div className="ss-head-left">
            <span className="ss-head-icon">
              <Icon name="search" size={16} />
            </span>
            <div>
              <p className="ss-head-eyebrow">Recherche avancée</p>
              <h2 className="ss-head-title">Trouve ce que tu cherches</h2>
            </div>
          </div>
          <button className="ss-close" onClick={onClose} aria-label="Fermer">
            <Icon name="close" size={18} />
          </button>
        </div>

        {/* ── Tabs (only on pick + results) ── */}
        {(step === "pick" || step === "results") && (
          <div className="ss-tabs">
            <button
              className={`ss-tab ${mode === "photo" ? "active" : ""}`}
              onClick={() => { setMode("photo"); reset(); }}
            >
              <Icon name="camera" size={14} /> Par photo
            </button>
            <button
              className={`ss-tab ${mode === "text" ? "active" : ""}`}
              onClick={() => { setMode("text"); reset(); }}
            >
              <Icon name="search" size={14} /> Par description
            </button>
          </div>
        )}

        {/* ── Body ── */}
        <div className="ss-body">

          {/* Pick — photo */}
          {step === "pick" && mode === "photo" && (
            <div className="ss-photo-pick">
              <div
                ref={dropRef}
                className="ss-drop-zone"
                onDragOver={(e) => { e.preventDefault(); dropRef.current?.classList.add("drag-over"); }}
                onDragLeave={() => dropRef.current?.classList.remove("drag-over")}
                onDrop={(e) => { dropRef.current?.classList.remove("drag-over"); handleDrop(e); }}
                onClick={() => fileRef.current?.click()}
              >
                <span className="ss-drop-icon"><Icon name="camera" size={32} /></span>
                <p className="ss-drop-title">Glisse une photo ici</p>
                <p className="ss-drop-sub">ou clique pour choisir depuis ta galerie</p>
              </div>
              <div className="ss-or-row"><span>ou</span></div>
              <button className="ss-camera-btn" onClick={() => cameraRef.current?.click()}>
                <Icon name="camera" size={16} /> Prendre une photo
              </button>
              <input ref={fileRef}   type="file" accept="image/*"               className="ss-hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
              <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="ss-hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
              {error && <p className="ss-error">{error}</p>}
            </div>
          )}

          {/* Pick — text */}
          {step === "pick" && mode === "text" && (
            <div className="ss-text-pick">
              <label className="ss-text-label">Décris l'article que tu cherches</label>
              <textarea
                className="ss-textarea"
                placeholder="Ex : baskets blanches taille 42, veste en jean Levi's…"
                value={textQuery}
                onChange={(e) => setTextQuery(e.target.value)}
                rows={4}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && textQuery.trim()) { e.preventDefault(); runSearch({ query: textQuery.trim() }); }}}
              />
              <button
                className="ss-search-btn"
                disabled={!textQuery.trim()}
                onClick={() => runSearch({ query: textQuery.trim() })}
              >
                <Icon name="search" size={15} /> Rechercher
              </button>
              {error && <p className="ss-error">{error}</p>}
            </div>
          )}

          {/* Scanning */}
          {step === "scanning" && (
            <div className="ss-status-wrap">
              {preview && <img src={preview} alt="" className="ss-status-thumb" />}
              <div className="ss-spinner"><span /><span /><span /></div>
              <p className="ss-status-text">Analyse de l'image en cours…</p>
            </div>
          )}

          {/* Select object */}
          {step === "select" && (
            <div className="ss-select-wrap">
              <div className="ss-select-row">
                {preview && <img src={preview} alt="" className="ss-select-thumb" />}
                <p className="ss-select-hint">Plusieurs articles détectés. Lequel veux-tu rechercher ?</p>
              </div>
              <div className="ss-chip-list">
                {detected.map((obj) => (
                  <button
                    key={obj.label}
                    className={`ss-chip ${selectedLabel === obj.label ? "active" : ""}`}
                    onClick={async () => { setSelectedLabel(obj.label); await runSearch({ query: obj.label, image: imageData ?? undefined }); }}
                  >
                    <span className="ss-chip-label">{obj.label}</span>
                    <span className="ss-chip-pct">{Math.round(obj.confidence * 100)}%</span>
                  </button>
                ))}
              </div>
              {error && <p className="ss-error">{error}</p>}
            </div>
          )}

          {/* Searching */}
          {step === "searching" && (
            <div className="ss-status-wrap">
              {preview && <img src={preview} alt="" className="ss-status-thumb" />}
              <div className="ss-spinner"><span /><span /><span /></div>
              <p className="ss-status-text">Recherche des annonces similaires…</p>
            </div>
          )}

          {/* Results */}
          {step === "results" && (
            <div className="ss-results-wrap">
              {/* Filter bar */}
              <div className="ss-filter-bar">
                <div className="ss-filter-query">
                  {preview && <img src={preview} alt="" className="ss-filter-thumb" />}
                  <span>«&nbsp;{selectedLabel ?? textQuery}&nbsp;»</span>
                </div>
                <select value={filterCategory} onChange={(e) => setFilterCategory(e.target.value)} aria-label="Catégorie">
                  <option value="">Toutes catégories</option>
                  {LISTING_CATEGORIES.map((c) => <option key={c}>{c}</option>)}
                </select>
                <select value={filterCondition} onChange={(e) => setFilterCondition(e.target.value)} aria-label="État">
                  <option value="">Tout état</option>
                  {CONDITIONS.map((c) => <option key={c}>{c}</option>)}
                </select>
                <select value={filterMax} onChange={(e) => setFilterMax(e.target.value)} aria-label="Prix max">
                  <option value="">Tout prix</option>
                  <option value="50">Moins de {formatMoney(50, currency)}</option>
                  <option value="100">Moins de {formatMoney(100, currency)}</option>
                  <option value="200">Moins de {formatMoney(200, currency)}</option>
                  <option value="500">Moins de {formatMoney(500, currency)}</option>
                </select>
                <button className="ss-new-btn" onClick={reset}>↺ Nouvelle</button>
              </div>

              {/* Count */}
              <p className="ss-count">
                {visibleResults.length} annonce{visibleResults.length !== 1 ? "s" : ""} trouvée{visibleResults.length !== 1 ? "s" : ""}
              </p>

              {visibleResults.length === 0 ? (
                <div className="ss-empty">
                  <span><Icon name="search" size={28} /></span>
                  <p>Aucune annonce ne correspond à ces critères.</p>
                  <button className="ss-new-btn" onClick={reset}>Nouvelle recherche</button>
                </div>
              ) : (
                <div className="ss-grid">
                  {visibleResults.map((item) => (
                    <button key={item.id} className="ss-card" onClick={() => onNavigate(item.id)}>
                      <div className="ss-card-img">
                        {item.image
                          ? <img src={item.image} alt={item.title} />
                          : <span className="ss-card-placeholder"><Icon name="store" size={24} /></span>
                        }
                        <em className="ss-card-cond">{item.condition}</em>
                      </div>
                      <div className="ss-card-info">
                        <small>{item.category}</small>
                        <strong>{item.title}</strong>
                        <b>{formatMoney(item.price, currency)}</b>
                      </div>
                    </button>
                  ))}
                </div>
              )}
              {error && <p className="ss-error">{error}</p>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default SmartSearchModal;
