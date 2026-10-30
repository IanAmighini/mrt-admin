import Link from "next/link";
import { ArrowDownLeft, ArrowUpRight, Hourglass, Receipt } from "lucide-react";
import { Prisma, type Currency } from "@prisma/client";
import { formatMoney, ZERO } from "@/lib/money";
import { CIRCUIT_LABELS, PAYMENT_METHOD_LABELS } from "@/lib/labels";
import { KpiCard } from "@/components/KpiCard";
import { ImporteEnPesos } from "./ImporteEnPesos";
import { getCobranzasReport, getDiasDeCobro, type CobranzasLado } from "@/lib/reports";
import { Barras, Panel } from "@/components/dashboard/Graficos";
import type { Period } from "@/lib/period";
import { formatFecha } from "@/lib/period";

function ars(byCurrency: Map<Currency, Prisma.Decimal>): Prisma.Decimal {
  return byCurrency.get("ARS") ?? ZERO;
}

async function LadoBlock({ period, lado }: { period: Period; lado: CobranzasLado }) {
  const esCobro = lado === "CLIENTES";
  const [report, dias] = await Promise.all([getCobranzasReport(period, lado), esCobro ? getDiasDeCobro(period) : null]);
  const entidadLabel = esCobro ? "Cliente" : "Proveedor";

  return (
    <div className="space-y-4">
      <div className={`grid gap-4 ${dias ? "sm:grid-cols-3" : "sm:grid-cols-2"}`}>
        <KpiCard
          label={esCobro ? "Cobrado en el período" : "Pagado en el período"}
          value={formatMoney(ars(report.totales))}
          icon={esCobro ? ArrowDownLeft : ArrowUpRight}
          color={esCobro ? "green" : "red"}
        />
        <KpiCard
          label="Movimientos"
          value={String(report.rows.length)}
          caption={`de ${report.porEntidad.length} ${entidadLabel.toLowerCase()}(s)`}
          icon={Receipt}
          color="blue"
        />
        {dias && (
          <KpiCard
            label="Días promedio de cobro"
            value={dias.promedio === null ? "—" : `${dias.promedio} días`}
            caption="desde la entrega (el remito) hasta el cobro; una factura sin remito, desde su fecha"
            icon={Hourglass}
            color="amber"
          />
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel titulo="Por medio de pago" nota="En pesos">
          <Barras
            colorPorDefecto={esCobro ? "verde" : "naranja"}
            filas={report.porMetodo.map((m) => ({ clave: m.method, nombre: PAYMENT_METHOD_LABELS[m.method], valor: ars(m.byCurrency) }))}
          />
        </Panel>
        {dias ? (
          <Panel titulo="Cuánto tarda cada cliente en pagar" nota="Días promedio, por cada peso cobrado en el período">
            <Barras
              colorPorDefecto="amarillo"
              filas={dias.porCliente.slice(0, 10).map((c) => ({
                clave: c.slug,
                nombre: c.nombre,
                href: `/cuentas-corrientes/${c.slug}`,
                valor: new Prisma.Decimal(Math.max(c.dias, 0.5)),
                texto: `${c.dias} ${c.dias === 1 ? "día" : "días"}`,
              }))}
            />
          </Panel>
        ) : (
          <Panel titulo={`Por ${entidadLabel.toLowerCase()}`} nota="En pesos">
            <Barras
              colorPorDefecto="naranja"
              filas={report.porEntidad.slice(0, 10).map((e) => ({
                clave: e.entitySlug,
                nombre: e.entityName,
                href: `/cuentas-corrientes/${e.entitySlug}`,
                valor: ars(e.byCurrency),
              }))}
            />
          </Panel>
        )}
      </div>

      <section>
        <h3 className="text-sm font-semibold mb-2">Por medio de pago</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-foreground/10 text-left text-foreground/60">
                <th className="py-2 pr-4">Medio</th>
                <th className="py-2 pr-4">Cantidad</th>
                <th className="py-2 pr-4">Importe</th>
              </tr>
            </thead>
            <tbody>
              {report.porMetodo.map((m) => (
                <tr key={m.method} className="border-b border-foreground/5">
                  <td className="py-2 pr-4">{PAYMENT_METHOD_LABELS[m.method]}</td>
                  <td className="py-2 pr-4">{m.count}</td>
                  <td className="py-2 pr-4 font-medium"><ImporteEnPesos porMoneda={m.byCurrency} /></td>
                </tr>
              ))}
              {report.porMetodo.length === 0 && (
                <tr>
                  <td colSpan={3} className="py-6 text-center text-foreground/40">
                    Sin movimientos en este período.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {report.porEntidad.length > 0 && (
        <section>
          <h3 className="text-sm font-semibold mb-2">Por {entidadLabel.toLowerCase()}</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-foreground/10 text-left text-foreground/60">
                  <th className="py-2 pr-4">{entidadLabel}</th>
                  <th className="py-2 pr-4">Cantidad</th>
                  <th className="py-2 pr-4">Importe</th>
                </tr>
              </thead>
              <tbody>
                {report.porEntidad.map((e) => (
                  <tr key={e.entitySlug} className="border-b border-foreground/5">
                    <td className="py-2 pr-4">
                      <Link href={`/cuentas-corrientes/${e.entitySlug}`} className="underline underline-offset-2">
                        {e.entityName}
                      </Link>
                    </td>
                    <td className="py-2 pr-4">{e.count}</td>
                    <td className="py-2 pr-4 font-medium"><ImporteEnPesos porMoneda={e.byCurrency} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {report.rows.length > 0 && (
        <section>
          <h3 className="text-sm font-semibold mb-2">Detalle</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-foreground/10 text-left text-foreground/60">
                  <th className="py-2 pr-4">Fecha</th>
                  <th className="py-2 pr-4">{entidadLabel}</th>
                  <th className="py-2 pr-4">Cuenta</th>
                  <th className="py-2 pr-4">Medio</th>
                  <th className="py-2 pr-4">Monto</th>
                  <th className="py-2 pr-4">Tesorería</th>
                </tr>
              </thead>
              <tbody>
                {report.rows.map((row, i) => (
                  <tr key={`${row.entitySlug}-${i}`} className="border-b border-foreground/5">
                    <td className="py-2 pr-4 whitespace-nowrap">{formatFecha(row.date)}</td>
                    <td className="py-2 pr-4">{row.entityName}</td>
                    <td className="py-2 pr-4">{CIRCUIT_LABELS[row.circuit]}</td>
                    <td className="py-2 pr-4">{PAYMENT_METHOD_LABELS[row.method]}</td>
                    <td className="py-2 pr-4 font-medium">{formatMoney(row.amount, row.currency)}</td>
                    <td className="py-2 pr-4">{row.tesoreria ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}

export async function CobranzasSection({ period }: { period: Period }) {
  return (
    <div className="space-y-10">
      <div>
        <h2 className="text-base font-semibold mb-3">Cobranzas a clientes</h2>
        <LadoBlock period={period} lado="CLIENTES" />
      </div>
      <div>
        <h2 className="text-base font-semibold mb-3">Pagos a proveedores</h2>
        <LadoBlock period={period} lado="PROVEEDORES" />
      </div>
    </div>
  );
}
