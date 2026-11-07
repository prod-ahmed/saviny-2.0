"use client";

import { useFormStatus } from "react-dom";

export function SubmitButton({ label = "Ajouter la transaction" }: { label?: string }) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full py-3 px-4 bg-[#102a29] text-white font-semibold rounded-xl hover:bg-[#1a3f3e] disabled:opacity-50 transition cursor-pointer flex items-center justify-center gap-2 shadow-sm"
    >
      {pending ? (
        <>
          <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin"></span>
          <span>Traitement Server Action...</span>
        </>
      ) : (
        <span>{label}</span>
      )}
    </button>
  );
}

