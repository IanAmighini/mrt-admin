import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { formatMoney } from "@/lib/money";

export type SaldoRow = {
  entity: { id: string; name: string };
  blancoSaldo: Prisma.Decimal | null;
  negroSaldo: Prisma.Decimal | null;
};

/** Top 5 (u otro N) de una cuenta corriente por circuito — usado en los dashboards de clientes y
 * proveedores para separar la deuda Blanco de la Negro en vez de un único ranking combinado. */
export function TopDeudaSection({
  title,
  rows,
  circuit,
  entityNoun,
  emptyMessage,
}: {
  title: string;
  rows: SaldoRow[];
  circuit: "blanco" | "negro";
  entityNoun: string;
  emptyMessage: string;
}) {
  return (
    <section>
      <h2 className="text-sm font-semibold mb-2">{title}</h2>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-foreground/10 text-left text-foreground/60">
              <th className="py-2 pr-4">{entityNoun}</th>
              <th className="py-2 pr-4">Saldo</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ entity, blancoSaldo, negroSaldo }) => {
              const saldo = circuit === "blanco" ? blancoSaldo : negroSaldo;
              return (
                <tr key={entity.id} className="border-b border-foreground/5">
                  <td className="py-2 pr-4">
                    <Link href={`/cuentas-corrientes/${entity.id}/${circuit}`} className="underline underline-offset-2">
                      {entity.name}
                    </Link>
                  </td>
                  <td className="py-2 pr-4 font-medium">{saldo ? formatMoney(saldo) : "—"}</td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={2} className="py-4 text-center text-foreground/40">
                  {emptyMessage}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
