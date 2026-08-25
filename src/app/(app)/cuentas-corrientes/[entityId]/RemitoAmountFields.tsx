"use client";

import { useState } from "react";

const inputClass = "w-full rounded border border-black/20 px-3 py-2 text-sm";

type PriceInfo = { amount: number; currency: string };

export function RemitoAmountFields({
  products,
  priceMap,
}: {
  products: { id: string; name: string }[];
  priceMap: Record<string, PriceInfo>;
}) {
  const [productId, setProductId] = useState("");
  const [quantity, setQuantity] = useState("");
  const [amount, setAmount] = useState("");

  function suggest(nextProductId: string, nextQuantity: string) {
    const price = priceMap[nextProductId];
    const qty = Number(nextQuantity);
    if (price && qty > 0) {
      setAmount((price.amount * qty).toFixed(2));
    }
  }

  return (
    <>
      <div className="space-y-1">
        <label className="text-sm" htmlFor="productId">
          Producto (opcional)
        </label>
        <select
          id="productId"
          name="productId"
          value={productId}
          onChange={(e) => {
            setProductId(e.target.value);
            suggest(e.target.value, quantity);
          }}
          className={inputClass}
        >
          <option value="">— Sin producto —</option>
          {products.map((product) => (
            <option key={product.id} value={product.id}>
              {product.name}
              {priceMap[product.id]
                ? ` — ${priceMap[product.id].currency} ${priceMap[product.id].amount}`
                : ""}
            </option>
          ))}
        </select>
      </div>
      <div className="space-y-1">
        <label className="text-sm" htmlFor="quantity">
          Cantidad (opcional)
        </label>
        <input
          id="quantity"
          name="quantity"
          inputMode="decimal"
          value={quantity}
          onChange={(e) => {
            setQuantity(e.target.value);
            suggest(productId, e.target.value);
          }}
          className={inputClass}
        />
      </div>
      <div className="space-y-1">
        <label className="text-sm" htmlFor="amount">
          Monto
        </label>
        <input
          id="amount"
          name="amount"
          required
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          className={inputClass}
        />
      </div>
    </>
  );
}
