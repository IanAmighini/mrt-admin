import Link from "next/link";
import type { Currency, Prisma } from "@prisma/client";
import { formatMoney } from "@/lib/money";

/** Una fila de getEntitySaldos, con lo que esta lista usa. */
export type FilaDeCuenta = {
  entity: { id: string; slug: string; name: string; taxId: string | null; type: string; moneda: Currency };
  blancoSaldo: Prisma.Decimal | null;
  negroSaldo: Prisma.Decimal | null;
  total: number;
};

export type TarjetaDeSaldo = {
  label: string;
  /** El monto, ya formateado; sin monto, la tarjeta muestra sólo la cantidad. */
  valor?: string;
  detalle?: string;
  cantidad: number;
  /** Sin href, la tarjeta es informativa y no filtra. */
  href?: string;
  activa?: boolean;
  tono?: "deuda" | "favor" | "neutro";
};

/**
 * Las tarjetas de arriba de Clientes y Proveedores: cuánto se debe, cuánto está a favor y cuántos
 * están al día. Tocar una filtra la lista —reemplazan al desplegable de saldo— y tocarla de nuevo
 * saca el filtro.
 */
export function TarjetasDeSaldo({ tarjetas }: { tarjetas: TarjetaDeSaldo[] }) {
  return (
    <div className={`grid gap-3 sm:grid-cols-2 ${tarjetas.length > 3 ? "lg:grid-cols-4" : "lg:grid-cols-3"}`}>
      {tarjetas.map((t) => {
        const cuerpo = (
          <>
            <p className="text-sm text-foreground/60">
              {t.label}
              {t.valor !== undefined && <span className="text-foreground/40"> · {t.cantidad}</span>}
            </p>
            <p
              className={`mt-0.5 text-2xl font-semibold tabular-nums ${
                t.tono === "favor" ? "text-green-700 dark:text-green-400" : ""
              }`}
            >
              {t.valor ?? t.cantidad}
            </p>
            {t.detalle && <p className="text-xs text-foreground/50">{t.detalle}</p>}
          </>
        );
        const clase = `min-w-0 rounded-xl border bg-background p-4 shadow-sm ${
          t.activa ? "border-primary ring-2 ring-primary/40" : "border-foreground/10"
        }`;
        return t.href ? (
          <Link key={t.label} href={t.href} className={`${clase} transition-colors hover:border-primary`}>
            {cuerpo}
          </Link>
        ) : (
          <div key={t.label} className={clase}>
            {cuerpo}
          </div>
        );
      })}
    </div>
  );
}

const CONECTORES = new Set(["de", "del", "la", "las", "los", "el", "y"]);

/** Dos letras para el circulito: "Gonzalo Morosoli" → GM, "La Campechana" → LC. */
function iniciales(nombre: string) {
  const palabras = nombre
    .replace(/["'().,-]/g, " ")
    .split(/\s+/)
    .filter((p) => /\p{L}/u.test(p));
  const elegidas = palabras.filter((p, i) => i === 0 || !CONECTORES.has(p.toLowerCase()));
  // Una sola palabra ("CASSAN") lleva sus dos primeras letras, como hacen los contactos del teléfono.
  if (elegidas.length === 1) return elegidas[0].slice(0, 2).toUpperCase();
  return elegidas
    .slice(0, 2)
    .map((p) => p[0].toUpperCase())
    .join("");
}

/**
 * Una fila por cuenta: el nombre, sólo las cuentas que tienen saldo (los "$ 0,00" de la tabla
 * vieja eran la mitad de lo que había que leer), el total grande a la derecha y una barrita que
 * dice cuánto pesa contra el que más debe.
 */
export function FilasDeCuentas({
  filas,
  maximo,
  cotizacion,
  etiquetaFavor,
  extra,
}: {
  filas: FilaDeCuenta[];
  /** El saldo más grande, en pesos, contra el que se mide la barrita. */
  maximo: number;
  cotizacion: number | null;
  /** Qué dice debajo del total cuando es negativo: "a favor del cliente", "a favor nuestro". */
  etiquetaFavor: (fila: FilaDeCuenta) => string;
  /** Etiquetas propias de cada pantalla, como el rubro del proveedor. */
  extra?: (fila: FilaDeCuenta) => React.ReactNode;
}) {
  return (
    <div className="divide-y divide-foreground/10 rounded-xl border border-foreground/10 bg-background shadow-sm">
      {filas.map((fila) => {
        const { entity, blancoSaldo, negroSaldo, total } = fila;
        const enPesos = entity.moneda === "USD" && cotizacion ? total * cotizacion : total;
        const ancho = total > 0 && maximo > 0 ? Math.max(2, Math.round((enPesos / maximo) * 100)) : 0;
        const cuentas = [
          { label: "Cuenta 1", saldo: blancoSaldo },
          { label: "Cuenta 2", saldo: negroSaldo },
        ].filter((c) => c.saldo && !c.saldo.isZero());
        return (
          <Link
            key={entity.id}
            href={`/cuentas-corrientes/${entity.slug}`}
            className="flex items-center gap-3 px-4 py-3 transition-colors first:rounded-t-xl last:rounded-b-xl hover:bg-foreground/[0.03]"
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-foreground/[0.06] text-xs font-semibold text-foreground/60">
              {iniciales(entity.name)}
            </span>
            <div className="min-w-0 flex-1">
              <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                <span className="font-medium">{entity.name}</span>
                {entity.taxId && <span className="text-xs text-foreground/40 tabular-nums">{entity.taxId}</span>}
                {entity.moneda === "USD" && (
                  <span className="rounded bg-blue-100 px-1.5 py-0.5 text-[11px] font-medium text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">
                    U$S
                  </span>
                )}
                {entity.type === "AMBOS" && (
                  <span className="rounded bg-foreground/[0.06] px-1.5 py-0.5 text-[11px] text-foreground/60">
                    Cliente y proveedor
                  </span>
                )}
                {extra?.(fila)}
              </p>
              {/* En el celular el total va acá, debajo del nombre: a la derecha dejaba al nombre en
                  dos o tres renglones. */}
              <p className={`font-semibold tabular-nums sm:hidden ${total < 0 ? "text-green-700 dark:text-green-400" : ""}`}>
                {formatMoney(total, entity.moneda)}
                {total < 0 && <span className="ml-1 text-xs font-normal text-foreground/50">{etiquetaFavor(fila)}</span>}
              </p>
              {cuentas.length > 0 && (
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {cuentas.map((c) => (
                    <span
                      key={c.label}
                      className="whitespace-nowrap rounded-md bg-foreground/[0.05] px-2 py-0.5 text-xs tabular-nums text-foreground/60"
                    >
                      {/* Con una sola cuenta el monto es el mismo que el total: alcanza con decir cuál. */}
                      {cuentas.length === 1 ? c.label : `${c.label} · ${formatMoney(c.saldo!, entity.moneda)}`}
                    </span>
                  ))}
                </div>
              )}
              {ancho > 0 && (
                <div className="mt-2 h-1 overflow-hidden rounded-full bg-foreground/[0.06]">
                  <div className="h-full rounded-full bg-primary" style={{ width: `${ancho}%` }} />
                </div>
              )}
            </div>
            {/* Ancho fijo: con el ancho del número, cada barrita terminaba en otro lugar. */}
            <div className="hidden w-44 shrink-0 text-right sm:block">
              <p
                className={`text-lg font-semibold tabular-nums ${
                  total < 0 ? "text-green-700 dark:text-green-400" : ""
                }`}
              >
                {formatMoney(total, entity.moneda)}
              </p>
              {total < 0 && <p className="text-xs text-foreground/50">{etiquetaFavor(fila)}</p>}
            </div>
          </Link>
        );
      })}
    </div>
  );
}

/** Los que están en cero, al final y en chips: una fila entera para decir "$ 0,00" no aporta. */
export function CuentasAlDia({ filas, titulo = "Al día" }: { filas: FilaDeCuenta[]; titulo?: string }) {
  if (filas.length === 0) return null;
  return (
    <div className="space-y-2">
      <p className="text-sm text-foreground/60">
        {titulo} <span className="text-foreground/40">· {filas.length}</span>
      </p>
      <div className="flex flex-wrap gap-2">
        {filas.map(({ entity }) => (
          <Link
            key={entity.id}
            href={`/cuentas-corrientes/${entity.slug}`}
            className="rounded-full border border-foreground/15 px-3 py-1 text-sm text-foreground/70 transition-colors hover:border-primary hover:text-foreground"
          >
            {entity.name}
          </Link>
        ))}
      </div>
    </div>
  );
}

/** El link de una tarjeta: el mismo filtro de saldo la saca, otro la reemplaza; el resto queda. */
export function hrefConSaldo(
  base: string,
  params: Record<string, string | undefined>,
  saldo: string,
  actual: string
) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) q.set(k, v);
  if (saldo !== actual) q.set("saldo", saldo);
  const s = q.toString();
  return s ? `${base}?${s}` : base;
}
