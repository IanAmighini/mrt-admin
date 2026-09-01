import Link from "next/link";
import { requireRole } from "@/lib/auth-helpers";
import { getEntitySaldos, getRecentCompras, getRecentPayments } from "@/lib/ledger";
import { getCostoInsumosDelMes, getValuacionInsumos } from "@/lib/reports";
import { formatMoney, formatQuantity } from "@/lib/money";
import { PAYMENT_METHOD_LABELS } from "@/lib/labels";

export default async function DashboardProveedoresPage() {
  const user = await requireRole(["ADMIN", "CARGA_DIARIA", "SOLO_LECTURA"]);
  const isAdmin = user.role === "ADMIN";

  const [compras, pagos, saldos] = await Promise.all([
    getRecentCompras(8),
    getRecentPayments(["PROVEEDOR", "AMBOS"], 8),
    getEntitySaldos(["PROVEEDOR", "AMBOS"]),
  ]);

  return (
    <div className="space-y-10">
      <div>
        <h1 className="text-xl font-semibold mb-1">Dashboard Proveedores</h1>
        <p className="text-sm text-foreground/60">
          Últimas compras, últimos pagos y proveedores a los que más les debemos.
        </p>
      </div>

      <div className="grid gap-8 lg:grid-cols-2">
        <section>
          <h2 className="text-sm font-semibold mb-2">Últimas compras</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-foreground/10 text-left text-foreground/60">
                  <th className="py-2 pr-4">Proveedor</th>
                  <th className="py-2 pr-4">Remito</th>
                  <th className="py-2 pr-4">Fecha</th>
                  <th className="py-2 pr-4">Total</th>
                </tr>
              </thead>
              <tbody>
                {compras.map((doc) => (
                  <tr key={doc.id} className="border-b border-foreground/5">
                    <td className="py-2 pr-4">
                      <Link
                        href={`/cuentas-corrientes/${doc.account.entityId}`}
                        className="underline underline-offset-2"
                      >
                        {doc.account.entity.name}
                      </Link>
                    </td>
                    <td className="py-2 pr-4">#{doc.number}</td>
                    <td className="py-2 pr-4">{doc.date.toLocaleDateString("es-AR")}</td>
                    <td className="py-2 pr-4">{formatMoney(doc.totalAmount, doc.currency)}</td>
                  </tr>
                ))}
                {compras.length === 0 && (
                  <tr>
                    <td colSpan={4} className="py-4 text-center text-foreground/40">
                      Todavía no hay compras cargadas.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section>
          <h2 className="text-sm font-semibold mb-2">Últimos pagos</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-foreground/10 text-left text-foreground/60">
                  <th className="py-2 pr-4">Proveedor</th>
                  <th className="py-2 pr-4">Monto</th>
                  <th className="py-2 pr-4">Medio</th>
                  <th className="py-2 pr-4">Fecha</th>
                </tr>
              </thead>
              <tbody>
                {pagos.map((payment) => (
                  <tr key={payment.id} className="border-b border-foreground/5">
                    <td className="py-2 pr-4">
                      <Link
                        href={`/cuentas-corrientes/${payment.account.entityId}`}
                        className="underline underline-offset-2"
                      >
                        {payment.account.entity.name}
                      </Link>
                    </td>
                    <td className="py-2 pr-4">{formatMoney(payment.amount, payment.currency)}</td>
                    <td className="py-2 pr-4">{PAYMENT_METHOD_LABELS[payment.method]}</td>
                    <td className="py-2 pr-4">{payment.date.toLocaleDateString("es-AR")}</td>
                  </tr>
                ))}
                {pagos.length === 0 && (
                  <tr>
                    <td colSpan={4} className="py-4 text-center text-foreground/40">
                      Todavía no hay pagos cargados.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="lg:col-span-2">
          <h2 className="text-sm font-semibold mb-2">Proveedores que más les debemos</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-foreground/10 text-left text-foreground/60">
                  <th className="py-2 pr-4">Proveedor</th>
                  <th className="py-2 pr-4">Saldo Blanco</th>
                  <th className="py-2 pr-4">Saldo Negro</th>
                  <th className="py-2 pr-4">Total</th>
                </tr>
              </thead>
              <tbody>
                {saldos.slice(0, 8).map(({ entity, blancoSaldo, negroSaldo, total }) => (
                  <tr key={entity.id} className="border-b border-foreground/5">
                    <td className="py-2 pr-4">
                      <Link
                        href={`/cuentas-corrientes/${entity.id}`}
                        className="underline underline-offset-2"
                      >
                        {entity.name}
                      </Link>
                    </td>
                    <td className="py-2 pr-4">{blancoSaldo ? formatMoney(blancoSaldo) : "—"}</td>
                    <td className="py-2 pr-4">{negroSaldo ? formatMoney(negroSaldo) : "—"}</td>
                    <td className="py-2 pr-4 font-medium">{formatMoney(total)}</td>
                  </tr>
                ))}
                {saldos.length === 0 && (
                  <tr>
                    <td colSpan={4} className="py-4 text-center text-foreground/40">
                      Todavía no hay proveedores cargados.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      {isAdmin && <ReportesGerenciales />}
    </div>
  );
}

async function ReportesGerenciales() {
  const [valuacion, costo] = await Promise.all([getValuacionInsumos(), getCostoInsumosDelMes()]);

  return (
    <section className="space-y-6">
      <h2 className="text-lg font-semibold">Reportes gerenciales</h2>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-xl border border-foreground/10 bg-background shadow-sm p-4">
          <p className="text-sm font-semibold mb-1">Costo de insumos consumidos (este mes)</p>
          <p className="text-2xl font-semibold">{formatMoney(costo.total)}</p>
          <p className="text-xs text-foreground/50 mt-1">
            insumos consumidos en producción este mes, valorizados a costo unitario.
            {costo.itemsSinCosto > 0 &&
              ` — ${costo.itemsSinCosto} insumo(s) consumido(s) sin costo unitario cargado, no se incluyeron.`}
          </p>
        </div>
        <div className="rounded-xl border border-foreground/10 bg-background shadow-sm p-4">
          <p className="text-sm font-semibold mb-1">Valuación de insumos en stock</p>
          <p className="text-2xl font-semibold">{formatMoney(valuacion.total)}</p>
          <div className="mt-2 max-h-40 overflow-y-auto">
            <table className="w-full text-xs">
              <tbody>
                {valuacion.rows.map(({ item, stock, valuacion: v }) => (
                  <tr key={item.id} className="border-b border-foreground/5">
                    <td className="py-1 pr-2">{item.name}</td>
                    <td className="py-1 pr-2">{formatQuantity(stock, item.unit)}</td>
                    <td className="py-1 pr-2">{v ? formatMoney(v) : "sin costo"}</td>
                  </tr>
                ))}
                {valuacion.rows.length === 0 && (
                  <tr>
                    <td className="py-2 text-foreground/40">Todavía no hay insumos cargados.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </section>
  );
}
