"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export default function BottomNav() {
  const pathname = usePathname();

  const items = [
    { label: "Dashboard", href: "/dashboard", icon: "📊" },
    { label: "Accounts", href: "/accounts", icon: "💳" },
    { label: "Transactions", href: "/transactions", icon: "💸" },
    { label: "Budgets", href: "/budgets", icon: "🎯" },
    { label: "Messages", href: "/messages", icon: "💬" },
  ];

  return (
    <nav className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-[#102a29] border-t border-emerald-900/50 flex items-center justify-around py-2 px-1 text-xs text-emerald-200">
      {items.map((item) => {
        const active = pathname === item.href;
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`flex flex-col items-center gap-1 py-1 px-3 rounded-lg transition ${
              active ? "text-white font-bold bg-emerald-800/40" : "hover:text-white"
            }`}
          >
            <span className="text-base">{item.icon}</span>
            <span>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

