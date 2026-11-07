"use client";

import { useEffect } from "react";

export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Application error:", error);
  }, [error]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#f6f8f7] p-6">
      <div className="max-w-md w-full bg-white rounded-2xl shadow-lg p-8 text-center border border-red-100">
        <div className="w-16 h-16 mx-auto mb-4 bg-red-100 text-red-600 rounded-full flex items-center justify-center text-2xl font-bold">
          ⚠️
        </div>
        <h2 className="text-xl font-bold text-gray-900 mb-2">Something went wrong</h2>
        <p className="text-sm text-gray-600 mb-6">
          {error.message || "An unexpected error occurred while rendering the page."}
        </p>
        <button
          onClick={() => reset()}
          className="w-full py-3 px-4 bg-[#102a29] text-white font-medium rounded-xl hover:bg-[#1a3f3e] transition cursor-pointer"
        >
          Try Again
        </button>
      </div>
    </div>
  );
}

