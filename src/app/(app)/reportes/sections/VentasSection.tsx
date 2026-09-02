import { Boxes, Droplets, DollarSign, Users } from "lucide-react";
import { Prisma, type Circuit, type Currency } from "@prisma/client";
import { formatMoney, formatQuantity, ZERO } from "@/lib/money";
import { CIRCUIT_LABELS } from "@/lib/labels";
import { KpiCard } from "@/components/KpiCard";
import { getVentasReport } from "@/lib/reports";
import type { Period } from "@/lib/period";

function ars(byCurrency: Map<Currency, Prisma.Decimal>): Prisma.Decimal {
  return byCurrency.get("ARS") ?? ZERO;
}

export async function VentasSection({ period, circuit }: { period: Period; circuit?: Circuit }) {
  const report = await getVentasReport(period, { circuit });

  const grupos: { title: string; label: string; rows: { key: string; name: string; pallets: Prisma.Decimal; litros: Prisma.Decimal; byCurrency: Map<Currency, Prisma.Decimal> }[] }[] = [
    {
      title: "Por cliente",
      label: "Cliente",
      rows: report.porCliente.map((r) => ({ key: r.entitySlug, name: r.entityName, ...r })),
    },
    {
      title: "Por marca",
      label: "Marca",
      rows: report.porMarca.map((r) => ({ key: r.marca, name: r.marca, ...r })),
    },
    {
      title: "Por producto",
      label: "Producto",
      rows: report.porProducto.map((r) => ({ key: r.productSlug, name: r.label, ...r })),
    },
  ];

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Facturado / entregado" value={formatMoney(ars(report.totales.byCurrency))} icon={DollarSign} color="green" />
        <KpiCard label="Pallets entregados" value={formatQuantity(report.totales.pallets)} icon={Boxes} color="blue" />
        <KpiCard label="Litros entregados" value={formatQuantity(report.totales.litros, "L")} icon={Droplets} color="blue" />
        <KpiCard
          label="Clientes"
          value={String(report.porCliente.length)}
          caption="con entregas en el período"
          icon={Users}
          color="amber"
        />
      </div>

      <section>
        <h2 className="text-sm font-semibold mb-2">Por circuito</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-foreground/10 text-left text-foreground/60">
                <th className="py-2 pr-4">Cuenta</th>
                <th className="py-2 pr-4">Pallets</th>
                <th className="py-2 pr-4">Litros</th>
                <th className="py-2 pr-4">Importe</th>
              </tr>
            </thead>
            <tbody>
              {(["BLANCO", "NEGRO"] as Circuit[]).map((c) => (
                <tr key={c} className="border-b border-foreground/5">
                  <td className="py-2 pr-4">{CIRCUIT_LABELS[c]}</td>
                  <td className="py-2 pr-4">{formatQuantity(report.porCircuito[c].pallets)}</td>
                  <td className="py-2 pr-4">{formatQuantity(report.porCircuito[c].litros, "L")}</td>
                  <td className="py-2 pr-4 font-medium">{formatMoney(ars(report.porCircuito[c].byCurrency))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {grupos.map((grupo) => (
        <section key={grupo.title}>
          <h2 className="text-sm font-semibold mb-2">{grupo.title}</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-foreground/10 text-left text-foreground/60">
                  <th className="py-2 pr-4">{grupo.label}</th>
                  <th className="py-2 pr-4">Pallets</th>
                  <th className="py-2 pr-4">Litros</th>
                  <th className="py-2 pr-4">Importe</th>
                </tr>
              </thead>
              <tbody>
                {grupo.rows.map((row) => (
                  <tr key={row.key} className="border-b border-foreground/5">
                    <td className="py-2 pr-4">{row.name}</td>
                    <td className="py-2 pr-4">{formatQuantity(row.pallets)}</td>
                    <td className="py-2 pr-4">{formatQuantity(row.litros, "L")}</td>
                    <td className="py-2 pr-4 font-medium">{formatMoney(ars(row.byCurrency))}</td>
                  </tr>
                ))}
                {grupo.rows.length === 0 && (
                  <tr>
                    <td colSpan={4} className="py-6 text-center text-foreground/40">
                      Sin entregas en este período.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </div>
  );
}
