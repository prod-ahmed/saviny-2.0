import Link from "next/link";
import { context } from "../../server/context";
import { SubmitButton } from "../../client/components/SubmitButton";
import { addQuickTransaction } from "../actions";
import BottomNav from "../../client/components/BottomNav";

export const dynamic = "force-dynamic";

/**
 * Page Items / Transactions (Chapitres 2, 4 & 5 du cours, page 17).
 * - Server Component (SSR) : lit directement dans MongoDB sur le serveur avant rendu HTML.
 * - Server Actions ('use server') : traite l'ajout via <form action={addQuickTransaction}>.
 * - useFormStatus : bouton avec état de chargement automatique.
 */
export default async function ItemsPage() {
  const { store } = await context();
  const transactions = await store.many("transactions", {}, { sort: { date: -1 }, limit: 20 });

  return (
    <div className="min-h-screen bg-[#f6f8f7] text-[#102a29] pb-24">
      {/* Header App Shell */}
      <header className="sticky top-0 z-30 bg-[#102a29] text-white px-6 py-4 flex items-center justify-between shadow-md">
        <div className="flex items-center gap-3">
          <Link href="/dashboard" className="text-emerald-300 hover:text-white transition">
            ← Dashboard
          </Link>
          <h1 className="text-xl font-bold">Données MongoDB (SSR + Server Actions)</h1>
        </div>
        <span className="text-xs bg-emerald-700/60 text-emerald-100 px-3 py-1 rounded-full border border-emerald-500/30">
          Server Component
        </span>
      </header>

      <main className="max-w-4xl mx-auto p-4 md:p-6 space-y-6">
        {/* Formulaire Server Action */}
        <section className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
          <h2 className="text-lg font-bold mb-1 flex items-center gap-2">
            <span>⚡</span> Ajouter une transaction (Server Action sans API)
          </h2>
          <p className="text-xs text-gray-500 mb-4">
            Ce formulaire envoie ses données directement à une fonction <code>'use server'</code> dans <code>app/actions.ts</code>.
          </p>

          <form action={addQuickTransaction} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Description</label>
                <input
                  required
                  name="description"
                  type="text"
                  placeholder="Ex: Facture électricité"
                  className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-emerald-700"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Montant ($)</label>
                <input
                  required
                  name="amount"
                  type="number"
                  step="0.01"
                  min="0.01"
                  placeholder="45.00"
                  className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-emerald-700"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Type</label>
                <select
                  name="type"
                  className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-emerald-700"
                >
                  <option value="expense">Dépense (Expense)</option>
                  <option value="income">Revenu (Income)</option>
                </select>
              </div>
            </div>

            <div className="pt-2">
              <SubmitButton label="Enregistrer via Server Action" />
            </div>
          </form>
        </section>

        {/* Liste Server-Side Rendered */}
        <section className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-lg font-bold">Transactions enregistrées ({transactions.length})</h2>
              <p className="text-xs text-gray-500">Données lues directement depuis MongoDB sur le serveur</p>
            </div>
            <span className="text-xs bg-gray-100 px-3 py-1 rounded-full text-gray-600 font-mono">
              SSR MongoDB
            </span>
          </div>

          <div className="divide-y divide-gray-100">
            {transactions.length === 0 ? (
              <p className="text-center py-8 text-gray-400 text-sm">Aucune transaction trouvée.</p>
            ) : (
              transactions.map((t) => (
                <div key={t.id} className="py-3 flex items-center justify-between hover:bg-gray-50/50 px-2 rounded-lg transition">
                  <div className="flex items-center gap-3">
                    <span className="text-xl">{t.type === "income" ? "📈" : "📉"}</span>
                    <div>
                      <p className="font-semibold text-sm text-gray-900">{t.description}</p>
                      <p className="text-xs text-gray-400">{t.date}</p>
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    <span
                      className={`text-sm font-bold ${
                        t.type === "income" ? "text-emerald-700" : "text-gray-900"
                      }`}
                    >
                      {t.type === "income" ? "+" : "-"}${Number(t.amount).toFixed(2)}
                    </span>
                    <Link
                      href={`/items/${t.id}`}
                      className="text-xs bg-gray-100 hover:bg-emerald-100 text-gray-700 hover:text-emerald-900 px-2.5 py-1.5 rounded-lg transition"
                    >
                      Détail [id] →
                    </Link>
                  </div>
                </div>
              ))
            )}
          </div>
        </section>
      </main>

      <BottomNav />
    </div>
  );
}

