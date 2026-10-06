"use client";

import { useState } from "react";
import { CARD_FIELD_MAX } from "@/lib/card-limits";
import type { CardAddress } from "@/components/card-templates/types";
import { unitLine } from "@/lib/address-unit";

export const EMPTY_ADDRESS: Required<CardAddress> = { street: "", unit: "", city: "", state: "", zip: "" };

export function formatAddress(a?: CardAddress | null): string {
  if (!a) return "";
  const line1 = [a.street, unitLine(a.unit)].filter(Boolean).join(", ");
  const line2 = [a.city, a.state, a.zip].filter(Boolean).join(", ");
  return [line1, line2].filter(Boolean).join(" · ");
}

const fieldCls =
  "w-full bg-gray-900 border border-gray-700 text-white placeholder-gray-600 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-blue-500 transition-colors";

export default function AddressInput({
  value,
  onChange,
}: {
  value: Required<CardAddress>;
  onChange: (a: Required<CardAddress>) => void;
}) {
  const [open, setOpen] = useState(false);
  const set = (k: keyof CardAddress, v: string) => onChange({ ...value, [k]: v });
  const summary = formatAddress(value);

  return (
    <div>
      <label className="block text-xs font-medium text-gray-400 mb-1.5">Address</label>
      {!open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="w-full text-left bg-gray-900 border border-gray-700 hover:border-gray-600 rounded-xl px-4 py-3 text-sm transition-colors"
        >
          {summary ? <span className="text-white">{summary}</span> : <span className="text-gray-600">Add address (optional)</span>}
        </button>
      ) : (
        <div className="space-y-2">
          <input
            autoFocus
            type="text"
            placeholder="Street address (e.g. 123 Main St)"
            maxLength={CARD_FIELD_MAX.addressLine}
            value={value.street}
            onChange={(e) => set("street", e.target.value)}
            className={fieldCls}
          />
          <input
            type="text"
            placeholder="Unit # (optional)"
            maxLength={20}
            value={value.unit}
            onChange={(e) => set("unit", e.target.value)}
            className={fieldCls}
          />
          <input
            type="text"
            placeholder="City"
            maxLength={CARD_FIELD_MAX.addressLine}
            value={value.city}
            onChange={(e) => set("city", e.target.value)}
            className={fieldCls}
          />
          <div className="grid grid-cols-2 gap-2">
            <input
              type="text"
              placeholder="State (e.g. CA)"
              maxLength={2}
              value={value.state}
              onChange={(e) => set("state", e.target.value.toUpperCase())}
              className={fieldCls}
            />
            <input
              type="text"
              placeholder="Zip code"
              maxLength={10}
              value={value.zip}
              onChange={(e) => set("zip", e.target.value)}
              className={fieldCls}
            />
          </div>
          <button type="button" onClick={() => setOpen(false)} className="text-xs text-gray-500 hover:text-gray-300 transition-colors">
            Done
          </button>
        </div>
      )}
    </div>
  );
}
