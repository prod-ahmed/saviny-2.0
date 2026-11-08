import { useEffect, useRef, useState, type FormEvent } from "react";
import { useNavigate, useParams } from "react-router";
import { CameraCapture } from "../components/CameraCapture";
import { ContactForm, ListingForm, LISTING_CATEGORIES } from "../components/forms";
import { Confirm, EmptyState, FormError, Icon, Modal, PageHeader, StateText } from "../components/ui";
import { api, apiUpload } from "../lib/api";
import { formatMoney, timeAgo } from "../lib/format";
import { useApi, useSession } from "../lib/hooks";
import type { Listing } from "../lib/types";

interface PhotoItemCandidate {
  name: string;
  keywords: string[];
  category: string;
  box: { x: number; y: number; width: number; height: number };
}

export default function Marketplace() {
  const { id } = useParams();
  if (id === "favorites") return <ListingGrid mode="favorites" />;
  if (id === "my-listings") return <ListingGrid mode="mine" />;
  if (id) return <ListingDetail id={id} />;
  return <ListingGrid mode="all" />;
}

/** Favorite toggle shared by the grid and the detail page. */
async function toggleFavorite(listing: Listing) {
  if (listing.favorited) await api(`/listings/${listing.id}/favorite`, { method: "DELETE" });
  else await api(`/listings/${listing.id}/favorite`, { method: "PUT" });
}

function ListingGrid({ mode }: { mode: "all" | "favorites" | "mine" }) {
  const navigate = useNavigate();
  const { user } = useSession();
  const currency = user?.currency ?? "USD";
  const [q, setQ] = useState("");
  const [category, setCategory] = useState("");
  const [maxPrice, setMaxPrice] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const [imageSelection, setImageSelection] = useState<{ file: File; preview: string } | null>(null);
  const [imageCandidates, setImageCandidates] = useState<PhotoItemCandidate[]>([]);
  const [visibleImageCandidates, setVisibleImageCandidates] = useState(0);
  const [imageFrame, setImageFrame] = useState<{ offsetX: number; offsetY: number; width: number; height: number } | null>(null);
  const [selectedImageItem, setSelectedImageItem] = useState<PhotoItemCandidate | null>(null);
  const [imageSearchTerms, setImageSearchTerms] = useState<string[]>([]);
  const [imageSearchBusy, setImageSearchBusy] = useState(false);
  const [imageScanProgress, setImageScanProgress] = useState(0);
  const [scanLine, setScanLine] = useState<number | null>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [imageSearchError, setImageSearchError] = useState("");
  const imageInput = useRef<HTMLInputElement>(null);
  const imagePreviewRef = useRef<HTMLImageElement>(null);
  const imageSearchRequest = useRef(0);
  const imageScanTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => () => {
    if (imageSelection) URL.revokeObjectURL(imageSelection.preview);
  }, [imageSelection]);

  useEffect(() => () => {
    imageSearchRequest.current += 1;
    if (imageScanTimer.current) clearInterval(imageScanTimer.current);
  }, []);

  const measurePreview = () => {
    const img = imagePreviewRef.current;
    if (!img?.naturalWidth || !img.naturalHeight) return;
    const width = img.clientWidth;
    const height = img.clientHeight;
    if (!width || !height) return;
    const scale = Math.min(width / img.naturalWidth, height / img.naturalHeight);
    const drawnW = img.naturalWidth * scale;
    const drawnH = img.naturalHeight * scale;
    setImageFrame({
      offsetX: (width - drawnW) / 2,
      offsetY: (height - drawnH) / 2,
      width: drawnW,
      height: drawnH,
    });
  };

  useEffect(() => {
    const img = imagePreviewRef.current;
    if (!img || !imageSelection) return;
    if (img.complete) measurePreview();
    const observer = new ResizeObserver(() => measurePreview());
    observer.observe(img);
    return () => observer.disconnect();
  }, [imageSelection]);

  const params = new URLSearchParams({ pageSize: "48" });
  if (mode === "mine") params.set("mine", "true");
  if (mode === "all") {
    const searchTerms = imageSearchTerms.length > 0 ? imageSearchTerms : q.trim() ? [q.trim()] : [];
    for (const term of searchTerms) params.append("q", term);
    if (category) params.set("category", category);
    if (maxPrice) params.set("maxPrice", maxPrice);
  }
  const listings = useApi<Listing[] | { items: Listing[] }>(mode === "favorites" ? "/favorites" : `/listings?${params}`);
  const items = Array.isArray(listings.data) ? listings.data : listings.data?.items;

  const searchByPhoto = async (file: File) => {
    if (!["image/jpeg", "image/png", "image/webp", "image/gif"].includes(file.type)) {
      setImageSearchError("Choose a JPEG, PNG, WebP or GIF photo.");
      return;
    }
    if (file.size > 4 * 1024 * 1024) {
      setImageSearchError("The photo must be 4 MB or smaller.");
      return;
    }
    const requestId = ++imageSearchRequest.current;
    setImageSelection({ file, preview: URL.createObjectURL(file) });
    setImageCandidates([]);
    setVisibleImageCandidates(0);
    setImageFrame(null);
    setSelectedImageItem(null);
    setImageSearchTerms([]);
    setImageSearchBusy(true);
    setImageScanProgress(4);
    setScanLine(null);
    setImageSearchError("");
    setError("");
    if (imageScanTimer.current) clearInterval(imageScanTimer.current);
    imageScanTimer.current = setInterval(() => {
      setImageScanProgress((progress) => Math.min(90, progress + Math.max(1, Math.round((90 - progress) * 0.08))));
    }, 350);
    try {
      const result = await apiUpload<{ items: PhotoItemCandidate[] }>("/ai/market/search-image", file);
      if (requestId !== imageSearchRequest.current) return;
      if (imageScanTimer.current) clearInterval(imageScanTimer.current);
      imageScanTimer.current = null;
      setImageScanProgress(92);
      const ordered = [...result.items].sort((a, b) => (a.box.y + a.box.height / 2) - (b.box.y + b.box.height / 2) || a.box.x - b.box.x);
      setImageCandidates(ordered);

      if (ordered.length === 0) {
        setImageScanProgress(100);
        setImageSearchBusy(false);
        setScanLine(null);
        return;
      }

      setScanLine(0);
      let line = 0;
      const cancelled = () => requestId !== imageSearchRequest.current;
      const glideLine = (target: number) => new Promise<void>((resolve) => {
        const from = line;
        const duration = Math.max(360, Math.min(1100, Math.abs(target - from) * 16));
        const start = performance.now();
        const step = (now: number) => {
          if (cancelled()) return resolve();
          const t = Math.min(1, (now - start) / duration);
          const eased = 1 - (1 - t) ** 2;
          line = from + (target - from) * eased;
          setScanLine(line);
          if (t < 1) requestAnimationFrame(step);
          else resolve();
        };
        requestAnimationFrame(step);
      });
      for (const [index, item] of ordered.entries()) {
        const center = Math.min(96, Math.max(4, item.box.y + item.box.height / 2));
        await glideLine(center);
        if (cancelled()) return;
        setVisibleImageCandidates(index + 1);
        setImageScanProgress(92 + Math.round(((index + 1) / ordered.length) * 8));
        await new Promise((resolve) => window.setTimeout(resolve, 260));
        if (cancelled()) return;
      }
      await glideLine(98);
      if (!cancelled()) setImageScanProgress(100);
    } catch (err) {
      if (requestId === imageSearchRequest.current) {
        if (imageScanTimer.current) clearInterval(imageScanTimer.current);
        imageScanTimer.current = null;
        setImageScanProgress(0);
        setImageSearchError(err instanceof Error ? err.message : "The photo could not be analyzed.");
      }
    } finally {
      if (requestId === imageSearchRequest.current) {
        if (imageScanTimer.current) clearInterval(imageScanTimer.current);
        imageScanTimer.current = null;
        setImageSearchBusy(false);
        setScanLine(null);
      }
    }
  };

  const searchForImageItem = (item: PhotoItemCandidate) => {
    setSelectedImageItem(item);
    setImageSearchTerms(item.keywords);
    setQ(item.name);
    setCategory(item.category);
    setImageSearchError("");
  };

  const clearPhotoSearch = () => {
    imageSearchRequest.current += 1;
    if (imageScanTimer.current) clearInterval(imageScanTimer.current);
    imageScanTimer.current = null;
    setImageSelection(null);
    setImageCandidates([]);
    setVisibleImageCandidates(0);
    setImageFrame(null);
    setSelectedImageItem(null);
    setImageSearchTerms([]);
    setImageScanProgress(0);
    setScanLine(null);
    setImageSearchError("");
    setImageSearchBusy(false);
    setCameraOpen(false);
    setQ("");
    setCategory("");
  };

  const favorite = async (listing: Listing) => {
    setError("");
    try {
      await toggleFavorite(listing);
      listings.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "The favorite could not be saved");
    }
  };

  const title = mode === "favorites" ? "Your favorites" : mode === "mine" ? "My listings" : "Marketplace";
  const description = mode === "favorites" ? "Listings you saved to look at later." : mode === "mine" ? "Manage what you have for sale." : "Buy thoughtfully, sell what you no longer need, and keep value circulating.";

  return (
    <div className="content module-page">
      <PageHeader eyebrow="COMMUNITY MARKETPLACE" title={title} description={description} action="Create listing" onAction={() => setCreating(true)} />
      {mode === "all" && (
        <>
        <section className="market-photo-cta" aria-label="Search marketplace by photo">
          <div className="market-photo-cta-icon"><Icon name="search" size={22} /></div>
          <div className="market-photo-cta-copy">
              <strong>Find similar items from a photo</strong>
              <p>Take a photo or choose one. A green line scans the picture, marks each item, and adds it to the list.</p>
          </div>
          <input
            ref={imageInput}
            className="sr-only"
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
            aria-label="Choose a photo to find similar listings"
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              if (file) void searchByPhoto(file);
              event.currentTarget.value = "";
            }}
          />
          <button className="primary" type="button" onClick={() => imageInput.current?.click()}>
            {imageSearchBusy ? "Choose another photo" : imageSelection ? "Change photo" : "Choose a photo"}
          </button>
          <button className="secondary" type="button" disabled={imageSearchBusy} onClick={() => setCameraOpen(true)}>
            {cameraOpen ? "Camera open" : "Use camera"}
          </button>
          {imageSearchError && !imageSelection && <p className="photo-search-error" role="alert">{imageSearchError}</p>}
          {cameraOpen && (
            <CameraCapture
              busy={imageSearchBusy}
              captureLabel="Capture and scan photo"
              onClose={() => setCameraOpen(false)}
              onCapture={(file) => {
                setCameraOpen(false);
                void searchByPhoto(file);
              }}
            />
          )}
        </section>
        <div className="page-toolbar market-toolbar">
          <div className="transaction-search"><Icon name="search" size={17} /><input aria-label="Search listings" placeholder="Search listings" value={q} onChange={(e) => { imageSearchRequest.current += 1; if (imageScanTimer.current) clearInterval(imageScanTimer.current); imageScanTimer.current = null; setImageSearchBusy(false); setImageSelection(null); setImageCandidates([]); setVisibleImageCandidates(0); setImageFrame(null); setSelectedImageItem(null); setImageScanProgress(0); setScanLine(null); setQ(e.target.value); setImageSearchTerms([]); }} /></div>
          <select aria-label="Category" value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">All categories</option>{LISTING_CATEGORIES.map((c) => <option key={c}>{c}</option>)}
          </select>
          <select aria-label="Price" value={maxPrice} onChange={(e) => setMaxPrice(e.target.value)}>
            <option value="">Any price</option><option value="100">Under {formatMoney(100, currency)}</option><option value="200">Under {formatMoney(200, currency)}</option>
          </select>
          <button className="secondary" onClick={() => navigate("/marketplace/favorites")}><Icon name="heart" size={16} /> Favorites</button>
          <button className="secondary" onClick={() => navigate("/marketplace/my-listings")}>My listings</button>
        </div>
        {imageSelection && (
          <section className="photo-search" aria-label="Photo search">
            <div className={`photo-scan-stage ${imageSearchBusy ? "is-scanning" : ""}`}>
              <img
                ref={imagePreviewRef}
                className="photo-search-preview"
                src={imageSelection.preview}
                alt="Photo being scanned for marketplace items"
                onLoad={measurePreview}
              />
              {imageSearchBusy && !imageFrame && <div className="scanner-laser" aria-hidden="true" />}
              {imageFrame && (
                <div
                  className="photo-scan-overlay"
                  style={{ left: imageFrame.offsetX, top: imageFrame.offsetY, width: imageFrame.width, height: imageFrame.height }}
                >
                  {imageSearchBusy && (
                    <div
                      className={`scanner-laser ${scanLine === null ? "" : "parked"}`}
                      style={scanLine === null ? undefined : { top: `${scanLine}%` }}
                      aria-hidden="true"
                    />
                  )}
                  {imageCandidates.slice(0, visibleImageCandidates).map((item, index) => (
                    <button
                      type="button"
                      key={`${item.name}-${item.category}-${index}`}
                      className={`photo-scan-box ${selectedImageItem === item ? "selected" : ""} ${imageSearchBusy && index === visibleImageCandidates - 1 ? "active" : ""}`}
                      style={{ left: `${item.box.x}%`, top: `${item.box.y}%`, width: `${item.box.width}%`, height: `${item.box.height}%` }}
                      aria-label={`Item ${index + 1}: ${item.name}`}
                      onClick={() => searchForImageItem(item)}
                    >
                      <span>{index + 1}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="photo-search-content">
              <div className="photo-search-status">
                <strong>{imageSearchBusy ? (visibleImageCandidates > 0 ? `Found ${visibleImageCandidates} of ${imageCandidates.length}` : "Scanning your photo…") : imageSearchError ? "We couldn’t scan this photo" : selectedImageItem ? `Showing similar items for ${selectedImageItem.name}` : visibleImageCandidates > 0 ? "Choose an item to search for" : "Choose an item to search for"}</strong>
                <span>{imageScanProgress}%</span>
              </div>
              <div className="photo-scan-progress" role="progressbar" aria-label="Photo scan progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={imageScanProgress}>
                <span style={{ width: `${imageScanProgress}%` }} />
              </div>
              <p>{imageSearchBusy ? "The green line moves over the photo. Each item is marked and added to the list as the line reaches it." : imageSearchError ? imageSelection.file.name : selectedImageItem ? "The matching marketplace listings are shown below." : "Select a marked item to search for similar listings."}</p>
              <div className="photo-item-choices" aria-label="Items found in photo" aria-live="polite">
                {imageCandidates.slice(0, visibleImageCandidates).map((item, index) => (
                  <button
                    type="button"
                    key={`${item.name}-${item.category}-${index}`}
                    className={`photo-item-enter ${selectedImageItem === item ? "selected" : ""}`}
                    aria-pressed={selectedImageItem === item}
                    onClick={() => searchForImageItem(item)}
                  >
                    <em>{index + 1}</em>
                    <strong>{item.name}</strong>
                    <small>{item.category}</small>
                    <span>{selectedImageItem === item ? "Showing matches" : "Find similar items"}</span>
                  </button>
                ))}
                {imageSearchBusy && visibleImageCandidates === 0 && <p className="photo-scan-waiting">Looking through the photo…</p>}
              </div>
              {imageSearchError && <p className="photo-search-error" role="alert">{imageSearchError}</p>}
              <div className="photo-search-actions">
                <button type="button" className="secondary" onClick={clearPhotoSearch}>Clear photo search</button>
                {imageSearchError && <button type="button" className="secondary" onClick={() => imageInput.current?.click()}>Choose another photo</button>}
              </div>
            </div>
          </section>
        )}
        </>
      )}
      <StateText loading={listings.loading} error={listings.error} empty={!items} />
      {error && <p className="auth-error" role="alert">{error}</p>}
      {items && items.length === 0 && (
        <EmptyState
          title={mode === "favorites" ? "Your favorites live here" : mode === "mine" ? "Start selling with Pennywise" : "No listings match"}
          text={mode === "favorites" ? "Tap the heart on any listing to save it for later." : mode === "mine" ? "Create your first listing and manage its availability from this page." : "Try another search, or be the first to list something in this category."}
          action={mode === "favorites" ? "Explore marketplace" : "Create listing"}
          onAction={() => (mode === "favorites" ? navigate("/marketplace") : setCreating(true))}
        />
      )}
      <div className="catalog-grid">
        {(items ?? []).map((item) => (
          <article className="catalog-card" key={item.id}>
            <button className="catalog-image" onClick={() => navigate(`/marketplace/${item.id}`)}>
              {item.image ? <img src={item.image} alt="" /> : <span className="listing-placeholder"><Icon name="store" /></span>}
              <em>{item.condition}</em>
            </button>
            {mode !== "mine" && <button className={`catalog-favorite ${item.favorited ? "liked" : ""}`} aria-label={item.favorited ? "Remove from favorites" : "Add to favorites"} onClick={() => favorite(item)}><Icon name="heart" size={18} /></button>}
            <small>{item.category} · {timeAgo(item.createdAt)}</small>
            <button className="catalog-title" onClick={() => navigate(`/marketplace/${item.id}`)}>{item.title}</button>
            <strong>{formatMoney(item.price, currency)}</strong>
            {mode === "mine" && <span className={`status ${item.status === "available" ? "success" : "danger"}`}>{item.status}</span>}
          </article>
        ))}
      </div>
      {creating && <Modal title="Create listing" onClose={() => setCreating(false)}>
        <ListingForm onSaved={() => { setCreating(false); listings.reload(); }} onCancel={() => setCreating(false)} />
      </Modal>}
    </div>
  );
}

function ListingDetail({ id }: { id: string }) {
  const navigate = useNavigate();
  const { user } = useSession();
  const currency = user?.currency ?? "USD";
  const listing = useApi<Listing>(`/listings/${id}`);
  const [contacting, setContacting] = useState(false);
  const [editing, setEditing] = useState(false);
  const [saleOpen, setSaleOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [aiPrice, setAiPrice] = useState<{ suggestedPrice: number; low: number; high: number; reasoning: string } | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState("");
  const l = listing.data;

  const requestAiAppraisal = async () => {
    if (!l) return;
    setAiLoading(true);
    setAiError("");
    try {
      const res = await api<{ suggestedPrice: number; low: number; high: number; reasoning: string }>("/ai/market/price", {
        method: "POST",
        json: {
          title: l.title,
          category: l.category,
          condition: l.condition,
          description: l.description,
        },
      });
      setAiPrice(res);
    } catch (err) {
      setAiError(err instanceof Error ? err.message : "Could not get the price estimate.");
    } finally {
      setAiLoading(false);
    }
  };

  const run = async (action: () => Promise<unknown>, after?: () => void) => {
    setBusy(true);
    setError("");
    try {
      await action();
      after?.();
      listing.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "The change could not be saved");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="content module-page">
      <StateText loading={listing.loading} error={listing.error} empty={!l} />
      {l && <>
        <PageHeader eyebrow="COMMUNITY MARKETPLACE" title={l.title} description={l.isOwner ? "Your listing" : `Listed by ${l.seller.name}`} />
        <div className="listing-detail">
          <div className="listing-gallery">
            {l.photos.length > 0 ? <img src={l.photos[0]} alt={l.title} /> : <span className="listing-placeholder large"><Icon name="store" size={48} /></span>}
          </div>
          <section className="card listing-info">
            <small>{l.category} · {l.condition} · {timeAgo(l.createdAt)}</small>
            <h2>{l.title}</h2>
            <strong>{formatMoney(l.price, currency)}</strong>
            <span className={`status ${l.status === "available" ? "success" : "danger"}`}>{l.status}</span>
            <p>{l.description}</p>
            <section className="rounded-xl border border-stone-200 bg-[#f8faf9] p-4" aria-label="Penny's price estimate">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold text-[#102a29]">Penny’s price estimate</h3>
                  <p className="mt-1 text-xs leading-relaxed text-stone-500">
                    Get a suggested price based on the item, its condition, and its description.
                  </p>
                </div>
                <button type="button" className="secondary" onClick={requestAiAppraisal} disabled={aiLoading}>
                  {aiLoading ? "Analyzing…" : "Ask Penny"}
                </button>
              </div>
              {aiError && <p className="mt-3 text-xs text-red-700" role="alert">{aiError}</p>}
              {aiPrice && (
                <div className="mt-3 rounded-lg border border-stone-200 bg-white p-3" aria-live="polite">
                  <p className="text-sm font-semibold text-[#102a29]">
                    Suggested price: {formatMoney(aiPrice.suggestedPrice, currency)}
                  </p>
                  <p className="mt-1 text-xs text-stone-600">
                    Estimated range: {formatMoney(aiPrice.low, currency)} – {formatMoney(aiPrice.high, currency)}
                  </p>
                  <p className="mt-2 text-xs leading-relaxed text-stone-600">{aiPrice.reasoning}</p>
                </div>
              )}
            </section>
            <div className="seller"><span className="avatar peach">{l.seller.initials}</span><div><strong>{l.seller.name}</strong><small>Pennywise member</small></div></div>
            {error && <p className="auth-error" role="alert">{error}</p>}
            {!l.isOwner && l.status === "available" && <>
              <button className="primary full-button" onClick={() => setContacting(true)}><Icon name="message" size={17} /> Contact seller</button>
              <button className={`outline full-button ${l.favorited ? "liked-text" : ""}`} disabled={busy} onClick={() => run(() => api(`/listings/${l.id}/favorite`, { method: l.favorited ? "DELETE" : "PUT" }))}>
                <Icon name="heart" size={17} /> {l.favorited ? "Remove from favorites" : "Save to favorites"}
              </button>
            </>}
            {l.isOwner && <div className="owner-actions">
              <button className="secondary" onClick={() => setEditing(true)}><Icon name="edit" size={15} /> Edit</button>
              {l.status !== "sold" && <button className="secondary" disabled={busy} onClick={() => run(() => api(`/listings/${l.id}/status`, { method: "POST", json: { status: l.status === "available" ? "unavailable" : "available" } }))}>
                {l.status === "available" ? "Mark unavailable" : "Make available"}
              </button>}
              {l.status !== "sold" && <button className="secondary" onClick={() => setSaleOpen(true)}>Record sale</button>}
              <button className="danger-button" onClick={() => setConfirmDelete(true)}><Icon name="trash" size={15} /> Delete</button>
            </div>}
          </section>
        </div>
        {contacting && <Modal title="Contact seller" onClose={() => setContacting(false)}>
          <ContactForm listing={l} onSaved={(conversationId) => { setContacting(false); navigate(`/messages/${conversationId}`); }} onCancel={() => setContacting(false)} />
        </Modal>}
        {editing && <Modal title="Edit listing" onClose={() => setEditing(false)}>
          <ListingForm initial={l} onSaved={() => { setEditing(false); listing.reload(); }} onCancel={() => setEditing(false)} />
        </Modal>}
        {saleOpen && <SaleDialog listing={l} onClose={() => setSaleOpen(false)} onSaved={() => { setSaleOpen(false); listing.reload(); }} />}
        {confirmDelete && <Confirm title="Delete this listing?" text="The listing and its photos are removed from the marketplace." confirmLabel="Delete" busy={busy}
          onCancel={() => setConfirmDelete(false)}
          onConfirm={() => run(() => api(`/listings/${l.id}`, { method: "DELETE" }), () => navigate("/marketplace/my-listings"))} />}
      </>}
    </div>
  );
}

function SaleDialog({ listing, onClose, onSaved }: { listing: Listing; onClose: () => void; onSaved: () => void }) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setBusy(true);
    setError("");
    try {
      await api(`/listings/${listing.id}/sale`, { method: "POST", json: { outcome: String(form.get("outcome")), amount: Number(form.get("amount")) || undefined } });
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "The sale could not be recorded");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title="Record sale" onClose={onClose}>
      <form className="flow-form" onSubmit={submit}>
        <div className="form-row">
          <label>Outcome<select name="outcome" defaultValue="completed"><option value="completed">Sold</option><option value="cancelled">Cancelled</option></select></label>
          <label>Final price<input name="amount" type="number" min="0.01" step="0.01" defaultValue={listing.price} /></label>
        </div>
        <FormError message={error} />
        <div className="form-actions"><button type="button" className="secondary" onClick={onClose}>Cancel</button><button className="primary" disabled={busy}>Save</button></div>
      </form>
    </Modal>
  );
}
