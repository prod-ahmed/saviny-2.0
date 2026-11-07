"use server";

import { revalidatePath } from "next/cache";
import { context } from "../server/context";
import { newId, nowIso, round2 } from "../server/common/security";

/**
 * Server Actions (Chapitre 5 du cours - Persistance MongoDB avec 'use server').
 * Traite les formulaires directement côté serveur sans route API séparée.
 */
export async function addQuickTransaction(formData: FormData): Promise<void> {
  const description = String(formData.get("description") ?? "").trim();
  const amount = Number(formData.get("amount") ?? 0);
  const type = String(formData.get("type") ?? "expense");
  const accountId = String(formData.get("accountId") ?? "");
  const categoryId = String(formData.get("categoryId") ?? "");
  const userId = String(formData.get("userId") ?? "demo-user");

  if (!description || amount <= 0) return;

  const { store } = await context();

  await store.insert("transactions", {
    id: newId(),
    user_id: userId,
    type: type === "income" ? "income" : "expense",
    amount: round2(amount),
    date: nowIso().slice(0, 10),
    description,
    account_id: accountId || null,
    category_id: categoryId || null,
    created_at: nowIso(),
  });

  revalidatePath("/items");
  revalidatePath("/transactions");
  revalidatePath("/dashboard");
}

export async function deleteQuickTransaction(id: string): Promise<void> {
  const { store } = await context();
  await store.remove("transactions", { id });
  revalidatePath("/items");
  revalidatePath("/transactions");
  revalidatePath("/dashboard");
}
