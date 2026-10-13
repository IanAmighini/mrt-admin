import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { formatMoney } from "@/lib/money";
import type { Circuit, Currency, EntityType, Prisma } from "@prisma/client";

function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`rounded-xl border border-foreground/10 bg-background shadow-sm p-4 ${className}`}>{children}</div>;
}

/** Qué quiere decir el saldo, en palabras: "Nos debe", "Le debemos", "A favor del cliente". */
function queEsElSaldo(total: number, tipo: EntityType | undefined, retiro: boolean) {
  if (Math.abs(total) < 0.005) return "Al día";
  if (tipo === "CLIENTE") return total > 0 ? "Nos debe" : "A favor del cliente";
  if (tipo === "PROVEEDOR") {
    if (total > 0) return "Le debemos";
    return retiro ? "Retirado a cuenta (adelanto de aceite)" : "A favor nuestro";
  }
  return "Saldo";
}

/**
 * Arriba de la ficha: el saldo total grande, con qué quiere decir, y las dos cuentas debajo, cada
 * una con su link al libro mayor. Al lado, lo que más se mira de cada uno: entregas y litros en
 * un cliente, compras o gastos en un proveedor.
 */
export function EntitySummaryCards({
  entitySlug,
  blancoSaldo,
  negroSaldo,
  moneda = "ARS",
  entityType,
  retiroSocietario = false,
  card3Label,
  card3Value,
  card4Label,
  card4Value,
  soloCircuito,
}: {
  entitySlug: string;
  blancoSaldo: Prisma.Decimal;
  negroSaldo: Prisma.Decimal;
  /** Los saldos están en esta moneda: en una cuenta en dólares, son dólares. */
  moneda?: Currency;
  entityType?: EntityType;
  retiroSocietario?: boolean;
  /** Sin las dos últimas —una caja no entrega ni compra— queda sólo el saldo. */
  card3Label?: string;
  card3Value?: string;
  card4Label?: string;
  card4Value?: string;
  /** Una caja es una sola cuenta: se muestra sólo la fila donde está guardada, rotulada "Saldo". */
  soloCircuito?: Circuit;
}) {
  const hayExtras = card3Label !== undefined && card4Label !== undefined;

  if (soloCircuito) {
    const saldo = soloCircuito === "BLANCO" ? blancoSaldo : negroSaldo;
    return (
      <Link href={`/cuentas-corrientes/${entitySlug}/${soloCircuito === "BLANCO" ? "blanco" : "negro"}`} className="block max-w-sm">
        <Card>
          <p className="text-sm text-foreground/60">Saldo</p>
          <p className="text-2xl font-semibold tabular-nums">{formatMoney(saldo, moneda)}</p>
        </Card>
      </Link>
    );
  }

  const total = blancoSaldo.plus(negroSaldo).toNumber();
  const aFavor = total < -0.004;
  const cuenta = (c: Circuit, saldo: Prisma.Decimal) => (
    <Link
      href={`/cuentas-corrientes/${entitySlug}/${c === "BLANCO" ? "blanco" : "negro"}`}
      className="group flex items-center justify-between gap-2 rounded-lg border border-foreground/10 px-3 py-2 transition-colors hover:border-primary hover:bg-foreground/[0.02]"
    >
      <span className="min-w-0">
        <span className="block text-xs text-foreground/50">{c === "BLANCO" ? "Cuenta 1 (c/factura)" : "Cuenta 2 (s/factura)"}</span>
        <span className="block font-semibold tabular-nums">{formatMoney(saldo, moneda)}</span>
      </span>
      <ChevronRight size={16} className="shrink-0 text-foreground/30 group-hover:text-foreground/70" />
    </Link>
  );

  return (
    <div className={`grid gap-3 sm:gap-4 ${hayExtras ? "lg:grid-cols-3" : ""}`}>
      <Card className={hayExtras ? "lg:col-span-2" : ""}>
        <p className="text-sm text-foreground/60">
          {queEsElSaldo(total, entityType, retiroSocietario)}
          {moneda === "USD" && <span className="ml-2 rounded bg-blue-100 px-1.5 py-0.5 text-[11px] font-medium text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">U$S</span>}
        </p>
        <p className={`text-3xl font-semibold tabular-nums ${aFavor ? "text-green-700 dark:text-green-400" : ""}`}>
          {/* Positivo siempre: la etiqueta de arriba ya dice de qué lado está. */}
          {formatMoney(Math.abs(total) < 0.005 ? 0 : Math.abs(total), moneda)}
        </p>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {cuenta("BLANCO", blancoSaldo)}
          {cuenta("NEGRO", negroSaldo)}
        </div>
      </Card>
      {hayExtras && (
        // Una arriba de la otra al costado del saldo: lado a lado quedaban estiradas al alto de la
        // tarjeta grande, medio vacías.
        <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-1">
          <Card>
            <p className="text-sm text-foreground/60">{card3Label}</p>
            <p className="text-xl font-semibold sm:text-2xl">{card3Value}</p>
          </Card>
          <Card>
            <p className="text-sm text-foreground/60">{card4Label}</p>
            <p className="text-xl font-semibold sm:text-2xl">{card4Value}</p>
          </Card>
        </div>
      )}
    </div>
  );
}
