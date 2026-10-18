import { useState } from "react";
import { currencyOptions } from "../lib/currencies";

/** Searchable list of every currency, shown with its flag. */
export function CurrencySelect({ value, onChange }: { value: string; onChange: (code: string) => void }) {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const options = currencyOptions().filter((c) => c.code === value || !q || c.code.toLowerCase().includes(q) || c.name.toLowerCase().includes(q));

  return (
    <div className="currency-select">
      <input aria-label="Search currencies" placeholder="Search by name or code, e.g. Yen or JPY" value={query} onChange={(e) => setQuery(e.target.value)} />
      <select aria-label="Currency" size={8} value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((c) => (
          <option key={c.code} value={c.code}>{c.flag} {c.code} — {c.name}</option>
        ))}
      </select>
    </div>
  );
}
