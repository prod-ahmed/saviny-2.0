export default function Loading() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-[#f6f8f7]">
      <div className="flex flex-col items-center gap-4">
        <div className="w-12 h-12 border-4 border-emerald-200 border-t-emerald-800 rounded-full animate-spin"></div>
        <p className="text-sm font-medium text-emerald-900 animate-pulse">Loading Saviny...</p>
      </div>
    </div>
  );
}

