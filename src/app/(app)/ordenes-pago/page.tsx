import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth-helpers";
import { formatMoney, sumDecimals } from "@/lib/money";
import { PAYMENT_METHOD_LABELS } from "@/lib/labels";
import { formatNumeroOP } from "@/lib/orden-pago";

export default async function OrdenesPagoPage() {
  await requireRole(["ADMIN", "SOLO_LECTURA", "SECRETARIA"]);

  const ordenes = await prisma.ordenPago.findMany({
    include: { entity: true, payments: true },
    orderBy: { numero: "desc" },
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold mb-1">Órdenes de pago</h1>
        <p className="text-sm text-foreground/60">
          El papel que firma el proveedor. Se genera desde su ficha, agrupando los pagos ya cargados
          — sólo de la cuenta Blanco.
        </p>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-foreground/10 text-left text-foreground/60">
              <th className="py-2 pr-4">N°</th>
              <th className="py-2 pr-4">Fecha</th>
              <th className="py-2 pr-4">Proveedor</th>
              <th className="py-2 pr-4">Medios</th>
              <th className="py-2 pr-4 text-right">Importe</th>
            </tr>
          </thead>
          <tbody>
            {ordenes.map((o) => (
              <tr key={o.id} className="border-b border-foreground/5">
                <td className="py-2 pr-4">
                  <Link href={`/ordenes-pago/${o.numero}`} className="underline underline-offset-2">
                    {formatNumeroOP(o.numero)}
                  </Link>
                </td>
                <td className="py-2 pr-4 whitespace-nowrap">{o.date.toLocaleDateString("es-AR")}</td>
                <td className="py-2 pr-4">{o.entity.name}</td>
                <td className="py-2 pr-4 text-foreground/60">
                  {Array.from(new Set(o.payments.map((p) => PAYMENT_METHOD_LABELS[p.method]))).join(" + ")}
                </td>
                <td className="py-2 pr-4 text-right tabular-nums">
                  {formatMoney(sumDecimals(o.payments.map((p) => p.amount)))}
                </td>
              </tr>
            ))}
            {ordenes.length === 0 && (
              <tr>
                <td colSpan={5} className="py-6 text-center text-foreground/40">
                  Todavía no hay órdenes de pago. Se generan desde la ficha del proveedor.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
