"use client";

import Link from "next/link";

export default function OfflinePage() {
  return (
    <main className="min-h-screen flex items-center justify-center bg-[#f6f8f7] text-[#102a29] p-6">
      <div className="max-w-md w-full bg-white rounded-2xl shadow-xl p-8 text-center border border-gray-100">
        <div className="flex items-center justify-center gap-3 mb-4">
          <img
            src="/assets/pennywise-logo.png"
            alt="Pennywise"
            className="w-14 h-14 rounded-full border-2 border-emerald-400 bg-white shadow-md object-cover"
          />
          <div className="w-12 h-12 bg-emerald-100 text-emerald-800 rounded-full flex items-center justify-center text-2xl font-bold">
            📶
          </div>
        </div>
        <h1 className="text-2xl font-bold mb-2">You are currently offline</h1>
        <p className="text-gray-600 mb-6 text-sm">
          Pennywise is a Progressive Web App (PWA). You can continue viewing previously cached pages. Any changes made offline are safely held in your local outbox and will synchronize once your internet connection is restored.
        </p>
        <div className="flex flex-col gap-3">
          <button
            onClick={() => window.location.reload()}
            className="w-full py-3 px-4 bg-[#102a29] text-white font-medium rounded-xl hover:bg-[#1a3f3e] transition cursor-pointer"
          >
            Retry Connection
          </button>
          <Link
            href="/"
            className="w-full py-2.5 px-4 text-sm text-gray-700 bg-gray-100 rounded-xl hover:bg-gray-200 transition"
          >
            Return to Dashboard
          </Link>
        </div>
      </div>
    </main>
  );
}

