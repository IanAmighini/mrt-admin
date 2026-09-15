"use client";

import { Printer } from "lucide-react";

/** Imprimir desde el navegador: de ahí sale el PDF que se manda o se firma. */
export function PrintButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary-hover"
    >
      <Printer size={16} />
      Imprimir
    </button>
  );
}
