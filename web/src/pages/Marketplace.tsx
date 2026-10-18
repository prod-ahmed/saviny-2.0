import { useState, type FormEvent } from "react";
import { useNavigate, useParams } from "react-router";
import { ContactForm, ListingForm, LISTING_CATEGORIES } from "../components/forms";
import { Confirm, EmptyState, FormError, Icon, Modal, PageHeader, StateText } from "../components/ui";
import { api } from "../lib/api";
import { formatMoney, timeAgo } from "../lib/format";
import { useApi, useSession } from "../lib/hooks";
import type { Listing } from "../lib/types";

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

  const params = new URLSearchParams({ pageSize: "48" });
  if (mode === "mine") params.set("mine", "true");
  if (mode === "all") {
    if (q.trim()) params.set("q", q.trim());
    if (category) params.set("category", category);
    if (maxPrice) params.set("maxPrice", maxPrice);
  }
  const listings = useApi<Listing[] | { items: Listing[] }>(mode === "favorites" ? "/favorites" : `/listings?${params}`);
  const items = Array.isArray(listings.data) ? listings.data : listings.data?.items;

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
        <div className="page-toolbar market-toolbar">
          <div className="transaction-search"><Icon name="search" size={17} /><input aria-label="Search listings" placeholder="Search listings" value={q} onChange={(e) => setQ(e.target.value)} /></div>
          <select aria-label="Category" value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">All categories</option>{LISTING_CATEGORIES.map((c) => <option key={c}>{c}</option>)}
          </select>
          <select aria-label="Price" value={maxPrice} onChange={(e) => setMaxPrice(e.target.value)}>
            <option value="">Any price</option><option value="100">Under {formatMoney(100, currency)}</option><option value="200">Under {formatMoney(200, currency)}</option>
          </select>
          <button className="secondary" onClick={() => navigate("/marketplace/favorites")}><Icon name="heart" size={16} /> Favorites</button>
          <button className="secondary" onClick={() => navigate("/marketplace/my-listings")}>My listings</button>
        </div>
      )}
      <StateText loading={listings.loading} error={listings.error} empty={!items} />
      {error && <p className="auth-error" role="alert">{error}</p>}
      {items && items.length === 0 && (
        <EmptyState
          title={mode === "favorites" ? "Your favorites live here" : mode === "mine" ? "Start selling with Saviny" : "No listings match"}
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
  const l = listing.data;

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
            <div className="seller"><span className="avatar peach">{l.seller.initials}</span><div><strong>{l.seller.name}</strong><small>Saviny member</small></div></div>
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
