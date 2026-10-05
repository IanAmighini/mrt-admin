"use client";

import { useState } from "react";
import { EXPENSE_CATEGORY_LABELS, EXPENSE_CATEGORY_ORDER } from "@/lib/labels";

const inputClass = "w-full rounded-lg border border-foreground/20 bg-background transition-colors focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary px-3 py-2 text-sm";
const submitClass =
  "w-fit rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary-hover";
const toggleClass =
  "cursor-pointer rounded-lg border border-foreground/20 px-4 py-2 text-center text-sm has-[:checked]:border-primary has-[:checked]:bg-primary has-[:checked]:text-primary-foreground";

/**
 * Un gasto de caja: lo que sale y no cancela la cuenta de nadie. Los campos son los mismos que las
 * columnas de la planilla —fecha, concepto, monto— más el rubro, que va opcional porque en la
 * planilla la columna CATEGORIA está casi siempre vacía y lo que se lee es el concepto.
 */
export function GastoDeCajaFields({
  hoy,
  cajaId,
  cajaNombre = "Caja chica",
}: {
  hoy: string;
  /** Vacío = la caja chica. */
  cajaId?: string;
  cajaNombre?: string;
}) {
  return (
    <>
      {cajaId && <input type="hidden" name="cajaId" value={cajaId} />}
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <label className="text-sm" htmlFor="date">
            Fecha
          </label>
          <input id="date" type="date" name="date" required defaultValue={hoy} className={inputClass} />
        </div>
        <div className="space-y-1">
          <label className="text-sm" htmlFor="amount">
            Monto *
          </label>
          <input id="amount" name="amount" required inputMode="decimal" placeholder="70.000" className={inputClass} />
        </div>
      </div>

      <div className="space-y-1">
        <label className="text-sm" htmlFor="concepto">
          Concepto *
        </label>
        <input
          id="concepto"
          name="concepto"
          required
          placeholder="Art. de limpieza"
          className={inputClass}
        />
      </div>

      <div className="space-y-1">
        <label className="text-sm" htmlFor="expenseCategory">
          Rubro
        </label>
        <select id="expenseCategory" name="expenseCategory" defaultValue="" className={inputClass}>
          <option value="">— Sin rubro —</option>
          {EXPENSE_CATEGORY_ORDER.map((c) => (
            <option key={c} value={c}>
              {EXPENSE_CATEGORY_LABELS[c]}
            </option>
          ))}
        </select>
        <p className="text-xs text-foreground/50">
          Con rubro, el gasto se suma al del mes por categoría. Sin rubro entra igual, como
          &quot;Otro&quot;.
        </p>
      </div>

      <p className="rounded-lg border border-foreground/10 bg-foreground/5 p-3 text-xs text-foreground/70">
        Si lo que pagaste es de un proveedor que está cargado —el gas, la papelera, el fumigador—
        no lo cargues acá: registrá el pago en su cuenta con Origen = {cajaNombre}. Así además de
        bajar la caja le baja la deuda.
      </p>

      <button type="submit" className={submitClass}>
        Cargar gasto
      </button>
    </>
  );
}

/**
 * El ajuste por arqueo: se contó la plata del cajón y no coincide con el saldo. Se carga la
 * diferencia —lo que sobró o lo que faltó— y el saldo queda igual a lo que se contó.
 */
export function AjusteDeCajaFields({ hoy, cajaId }: { hoy: string; cajaId?: string }) {
  const [sobra, setSobra] = useState(false);

  return (
    <>
      {cajaId && <input type="hidden" name="cajaId" value={cajaId} />}
      <div className="space-y-1">
        <p className="text-sm">¿Qué dio el arqueo?</p>
        <div className="grid grid-cols-2 gap-2">
          <label className={toggleClass}>
            <input
              type="radio"
              name="sentido"
              value="FALTA"
              checked={!sobra}
              onChange={() => setSobra(false)}
              className="sr-only"
            />
            Faltó plata
          </label>
          <label className={toggleClass}>
            <input
              type="radio"
              name="sentido"
              value="SOBRA"
              checked={sobra}
              onChange={() => setSobra(true)}
              className="sr-only"
            />
            Sobró plata
          </label>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <label className="text-sm" htmlFor="date">
            Fecha
          </label>
          <input id="date" type="date" name="date" required defaultValue={hoy} className={inputClass} />
        </div>
        <div className="space-y-1">
          <label className="text-sm" htmlFor="amount">
            Diferencia *
          </label>
          <input id="amount" name="amount" required inputMode="decimal" placeholder="1.500" className={inputClass} />
        </div>
      </div>

      <div className="space-y-1">
        <label className="text-sm" htmlFor="concepto">
          Motivo *
        </label>
        <input id="concepto" name="concepto" required placeholder="Arqueo del viernes" className={inputClass} />
      </div>

      <p className="text-xs text-foreground/50">
        {sobra ? "Sube" : "Baja"} el saldo de la caja por la diferencia, para que quede igual a lo que
        se contó. No es un gasto: si después aparece lo que faltaba cargar, cargalo y borrá este ajuste.
      </p>

      <button type="submit" className={submitClass}>
        Cargar ajuste
      </button>
    </>
  );
}

/** El pase: plata que se mueve entre dos cajas. Es un solo hecho, con una pata en cada libro. */
export function PaseDeCajaFields({
  hoy,
  cajaNombre,
  otrasCajas,
}: {
  hoy: string;
  cajaNombre: string;
  otrasCajas: { id: string; name: string }[];
}) {
  const [entra, setEntra] = useState(true);

  return (
    <>
      <div className="space-y-1">
        <p className="text-sm">¿Qué pasó?</p>
        <div className="grid grid-cols-2 gap-2">
          <label className={toggleClass}>
            <input
              type="radio"
              name="sentido"
              value="ENTRA"
              checked={entra}
              onChange={() => setEntra(true)}
              className="sr-only"
            />
            Entró plata
          </label>
          <label className={toggleClass}>
            <input
              type="radio"
              name="sentido"
              value="SALE"
              checked={!entra}
              onChange={() => setEntra(false)}
              className="sr-only"
            />
            Salió plata
          </label>
        </div>
      </div>

      <div className="space-y-1">
        <label className="text-sm" htmlFor="otraCajaId">
          {entra ? "Vino de" : "Fue a"}
        </label>
        <select id="otraCajaId" name="otraCajaId" required defaultValue={otrasCajas[0]?.id ?? ""} className={inputClass}>
          {otrasCajas.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <label className="text-sm" htmlFor="date">
            Fecha
          </label>
          <input id="date" type="date" name="date" required defaultValue={hoy} className={inputClass} />
        </div>
        <div className="space-y-1">
          <label className="text-sm" htmlFor="amount">
            Monto *
          </label>
          <input id="amount" name="amount" required inputMode="decimal" placeholder="2.000.000" className={inputClass} />
        </div>
      </div>

      <div className="space-y-1">
        <label className="text-sm" htmlFor="concepto">
          Detalle
        </label>
        <input id="concepto" name="concepto" placeholder="Para sueldos" className={inputClass} />
      </div>

      <p className="text-xs text-foreground/50">
        Se cargan los dos lados de una: {entra ? `baja la otra caja y sube ${cajaNombre}` : `baja ${cajaNombre} y sube la otra`}.
        No es un gasto — la plata sigue siendo de la empresa.
      </p>

      <button type="submit" className={submitClass}>
        Cargar pase
      </button>
    </>
  );
}
