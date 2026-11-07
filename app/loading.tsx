export default function Loading() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-[#f6f8f7]">
      <div className="flex flex-col items-center gap-4">
        <div className="relative">
          <div className="w-16 h-16 border-4 border-emerald-200 border-t-emerald-800 rounded-full animate-spin"></div>
          <img
            src="/assets/pennywise-logo.png"
            alt="Pennywise"
            className="w-10 h-10 rounded-full absolute inset-0 m-auto bg-white object-cover"
          />
        </div>
        <p className="text-sm font-bold text-emerald-900 animate-pulse tracking-wide">Chargement de Pennywise...</p>
      </div>
    </div>
  );
}

