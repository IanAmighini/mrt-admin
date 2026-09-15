"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, Package, Receipt, Scale } from "lucide-react";
import type { Entity } from "@prisma/client";
import { GastoFormFields } from "./GastoFormFields";
import { DocumentFormFields } from "./DocumentFormFields";

type Vista = "" | "GASTO" | "NOTA";

const opcionClass =
  "flex w-full items-start gap-3 rounded-lg border border-foreground/15 bg-background p-3 text-left transition-colors hover:border-primary hover:bg-foreground/5";

/**
 * Las tres formas de cargar algo en la cuenta, detrás de un solo botón.
 *
 * Elegir es el paso donde se equivoca: una factura de alquiler cargada como compra, o al revés. Por
 * eso cada opción dice para qué es antes de abrir su formulario, en vez de ser tres botones sueltos
 * compitiendo por el más parecido.
 */
export function CargarEnCuentaFields({
  entityId,
  rubroGasto,
  isTreasury,
}: {
  entityId: string;
  rubroGasto?: Entity["expenseCategory"];
  isTreasury?: boolean;
}) {
  const [vista, setVista] = useState<Vista>("");

  if (!vista) {
    return (
      <div className="space-y-2">
        {/* La compra es un formulario grande con sus líneas: tiene pantalla propia. */}
        <Link href={`/compras/nueva?entityId=${entityId}`} className={opcionClass}>
          <Package size={18} className="mt-0.5 shrink-0 text-foreground/40" />
          <span>
            <span className="block text-sm font-medium">Compra de insumos</span>
            <span className="block text-xs text-foreground/60">
              Lo que entra al depósito: aceite, envases, tapas, cajas, etiquetas. Suma stock.
            </span>
          </span>
        </Link>

        <button type="button" onClick={() => setVista("GASTO")} className={opcionClass}>
          <Receipt size={18} className="mt-0.5 shrink-0 text-foreground/40" />
          <span>
            <span className="block text-sm font-medium">Gasto</span>
            <span className="block text-xs text-foreground/60">
              Lo que se factura y no entra al depósito: flete, alquiler, luz, ferretería,
              honorarios. Va al libro de IVA.
            </span>
          </span>
        </button>

        <button type="button" onClick={() => setVista("NOTA")} className={opcionClass}>
          <Scale size={18} className="mt-0.5 shrink-0 text-foreground/40" />
          <span>
            <span className="block text-sm font-medium">Nota o ajuste</span>
            <span className="block text-xs text-foreground/60">
              Nota de crédito o débito, o una corrección del saldo que no es ni compra ni gasto.
            </span>
          </span>
        </button>
      </div>
    );
  }

  return (
    <>
      <input type="hidden" name="tipo" value={vista} />
      <button
        type="button"
        onClick={() => setVista("")}
        className="flex items-center gap-1.5 text-sm text-foreground/60 underline underline-offset-2 hover:text-foreground"
      >
        <ArrowLeft size={14} />
        Elegir otra cosa
      </button>

      {vista === "GASTO" ? (
        <GastoFormFields entityId={entityId} defaultValues={{ expenseCategory: rubroGasto ?? undefined }} />
      ) : (
        <DocumentFormFields fixedEntityId={entityId} isTreasury={isTreasury} />
      )}
    </>
  );
}
