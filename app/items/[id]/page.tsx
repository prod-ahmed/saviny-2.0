import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { context } from "../../../server/context";
import { deleteQuickTransaction } from "../../actions";
import { SubmitButton } from "../../../client/components/SubmitButton";
import BottomNav from "../../../client/components/BottomNav";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ id: string }>;
}

/**
 * Route dynamique [id] (Chapitre 2 du cours, pages 6 & 17).
 * - URL dynamique : /items/123 -> params.id
 * - Server Component avec chargement MongoDB direct.
 * - Mutation avec Server Action deleteQuickTransaction.
 */
export default async function ItemDetailPage({ params }: Props) {
  const { id } = await params;
  const { store } = await context();

  const item = await store.one("transactions", { id });
  if (!item) notFound();

  async function handleDelete() {
    "use server";
    await deleteQuickTransaction(id);
    redirect("/items");
  }

  return (
    <div className="min-h-screen bg-[#f6f8f7] text-[#102a29] pb-24">
      {/* Header */}
      <header className="sticky top-0 z-30 bg-[#102a29] text-white px-6 py-4 flex items-center justify-between shadow-md">
        <div className="flex items-center gap-3">
          <Link href="/items" className="text-emerald-300 hover:text-white transition">
            ← Liste des items
          </Link>
          <h1 className="text-xl font-bold">Détail [id] : {item.id.slice(0, 8)}...</h1>
        </div>
        <span className="text-xs bg-emerald-700/60 text-emerald-100 px-3 py-1 rounded-full border border-emerald-500/30">
          Route Dynamique
        </span>
      </header>

      <main className="max-w-2xl mx-auto p-4 md:p-6 space-y-6">
        <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100 space-y-4">
          <div className="flex items-center justify-between border-b border-gray-100 pb-4">
            <div>
              <span className="text-xs uppercase tracking-wider text-gray-400 font-bold">Identifiant (ID)</span>
              <p className="text-sm font-mono text-gray-700">{item.id}</p>
            </div>
            <span
              className={`text-xs uppercase px-3 py-1 rounded-full font-semibold ${
                item.type === "income" ? "bg-emerald-100 text-emerald-800" : "bg-gray-100 text-gray-800"
              }`}
            >
              {item.type}
            </span>
          </div>

          <div className="space-y-3">
            <div>
              <span className="text-xs text-gray-400">Description</span>
              <p className="text-base font-semibold text-gray-900">{item.description}</p>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <span className="text-xs text-gray-400">Montant</span>
                <p className="text-2xl font-bold text-[#102a29]">${Number(item.amount).toFixed(2)}</p>
              </div>
              <div>
                <span className="text-xs text-gray-400">Date</span>
                <p className="text-sm font-medium text-gray-700">{item.date}</p>
              </div>
            </div>

            {item.created_at && (
              <div>
                <span className="text-xs text-gray-400">Enregistré le</span>
                <p className="text-xs text-gray-500 font-mono">{item.created_at}</p>
              </div>
            )}
          </div>

          <div className="pt-4 border-t border-gray-100 flex items-center justify-between">
            <Link
              href="/items"
              className="text-sm text-gray-600 hover:text-gray-900 transition"
            >
              Retour à la liste
            </Link>

            <form action={handleDelete}>
              <SubmitButton label="Supprimer (Server Action)" />
            </form>
          </div>
        </div>
      </main>

      <BottomNav />
    </div>
  );
}

