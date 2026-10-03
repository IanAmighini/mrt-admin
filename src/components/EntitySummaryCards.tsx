import Link from "next/link";
import { formatMoney } from "@/lib/money";
import type { Circuit, Currency, Prisma } from "@prisma/client";

function Card({ children }: { children: React.ReactNode }) {
  return <div className="rounded-xl border border-foreground/10 bg-background shadow-sm p-4">{children}</div>;
}

export function EntitySummaryCards({
  entitySlug,
  blancoSaldo,
  negroSaldo,
  moneda = "ARS",
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
  /** Sin las dos últimas —una caja no entrega ni compra— quedan sólo los saldos, a media pantalla. */
  card3Label?: string;
  card3Value?: string;
  card4Label?: string;
  card4Value?: string;
  /** Una caja es una sola cuenta: se muestra sólo la fila donde está guardada, rotulada "Saldo". */
  soloCircuito?: Circuit;
}) {
  const hayExtras = card3Label !== undefined && card4Label !== undefined;
  const ver = (c: Circuit) => !soloCircuito || soloCircuito === c;
  return (
    <div className={`grid gap-4 ${hayExtras ? "sm:grid-cols-4" : "sm:grid-cols-2"}`}>
      {ver("BLANCO") && (
        <Link href={`/cuentas-corrientes/${entitySlug}/blanco`}>
          <Card>
            <p className="text-sm text-foreground/60">{soloCircuito ? "Saldo" : "Cuenta 1 (c/factura)"}</p>
            <p className="text-2xl font-semibold">{formatMoney(blancoSaldo, moneda)}</p>
          </Card>
        </Link>
      )}
      {ver("NEGRO") && (
        <Link href={`/cuentas-corrientes/${entitySlug}/negro`}>
          <Card>
            <p className="text-sm text-foreground/60">{soloCircuito ? "Saldo" : "Cuenta 2 (s/factura)"}</p>
            <p className="text-2xl font-semibold">{formatMoney(negroSaldo, moneda)}</p>
          </Card>
        </Link>
      )}
      {hayExtras && (
        <>
          <Card>
            <p className="text-sm text-foreground/60">{card3Label}</p>
            <p className="text-2xl font-semibold">{card3Value}</p>
          </Card>
          <Card>
            <p className="text-sm text-foreground/60">{card4Label}</p>
            <p className="text-2xl font-semibold">{card4Value}</p>
          </Card>
        </>
      )}
    </div>
  );
}
