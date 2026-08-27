import Link from "next/link";
import { formatMoney } from "@/lib/money";
import type { Prisma } from "@prisma/client";

function Card({ children }: { children: React.ReactNode }) {
  return <div className="rounded-lg border border-black/10 p-4">{children}</div>;
}

export function EntitySummaryCards({
  entityId,
  blancoSaldo,
  negroSaldo,
  card3Label,
  card3Value,
  card4Label,
  card4Value,
}: {
  entityId: string;
  blancoSaldo: Prisma.Decimal;
  negroSaldo: Prisma.Decimal;
  card3Label: string;
  card3Value: string;
  card4Label: string;
  card4Value: string;
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-4">
      <Link href={`/cuentas-corrientes/${entityId}/blanco`}>
        <Card>
          <p className="text-sm text-black/60">Cuenta 1 (c/factura)</p>
          <p className="text-2xl font-semibold">{formatMoney(blancoSaldo)}</p>
        </Card>
      </Link>
      <Link href={`/cuentas-corrientes/${entityId}/negro`}>
        <Card>
          <p className="text-sm text-black/60">Cuenta 2 (s/factura)</p>
          <p className="text-2xl font-semibold">{formatMoney(negroSaldo)}</p>
        </Card>
      </Link>
      <Card>
        <p className="text-sm text-black/60">{card3Label}</p>
        <p className="text-2xl font-semibold">{card3Value}</p>
      </Card>
      <Card>
        <p className="text-sm text-black/60">{card4Label}</p>
        <p className="text-2xl font-semibold">{card4Value}</p>
      </Card>
    </div>
  );
}
