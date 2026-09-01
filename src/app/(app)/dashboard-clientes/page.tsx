import Link from "next/link";
import { requireRole } from "@/lib/auth-helpers";
import {
  getEntitySaldos,
  getRecentPayments,
  getRecentRemitos,
  getVencimientos,
} from "@/lib/ledger";
import { getIngresosDelMes, getProductoEntregadoValorizado, getRentabilidadDelMes } from "@/lib/reports";
import { formatMoney, formatQuantity } from "@/lib/money";
import { formatProductLabel } from "@/lib/product-label";
import { PAYMENT_METHOD_LABELS } from "@/lib/labels";

export default async function DashboardClientesPage() {
  const user = await requireRole(["ADMIN", "CARGA_DIARIA", "SOLO_LECTURA"]);
  const isAdmin = user.role === "ADMIN";
  const today = new Date();

  const [entregas, pagos, saldos, vencimientos] = await Promise.all([
    getRecentRemitos(8),
    getRecentPayments(["CLIENTE", "AMBOS"], 8),
    getEntitySaldos(["CLIENTE", "AMBOS"]),
    getVencimientos(),
  ]);

  const remitosVencidos = vencimientos.filter(
    (doc) =>
      doc.type === "REMITO" &&
      ["CLIENTE", "AMBOS"].includes(doc.account.entity.type) &&
      doc.dueDate! < today
  );

  return (
    <div className="space-y-10">
      <div>
        <h1 className="text-xl font-semibold mb-1">Dashboard Clientes</h1>
        <p className="text-sm text-foreground/60">
          Últimas entregas, remitos vencidos, últimos pagos y clientes con más deuda.
        </p>
      </div>

      <div className="grid gap-8 lg:grid-cols-2">
        <section>
          <h2 className="text-sm font-semibold mb-2">Últimas entregas</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-foreground/10 text-left text-foreground/60">
                  <th className="py-2 pr-4">Cliente</th>
                  <th className="py-2 pr-4">Remito</th>
                  <th className="py-2 pr-4">Fecha</th>
                  <th className="py-2 pr-4">Total</th>
                </tr>
              </thead>
              <tbody>
                {entregas.map((doc) => (
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
                {entregas.length === 0 && (
                  <tr>
                    <td colSpan={4} className="py-4 text-center text-foreground/40">
                      Todavía no hay entregas cargadas.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section>
          <h2 className="text-sm font-semibold mb-2">Remitos vencidos</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-foreground/10 text-left text-foreground/60">
                  <th className="py-2 pr-4">Cliente</th>
                  <th className="py-2 pr-4">Remito</th>
                  <th className="py-2 pr-4">Vencimiento</th>
                  <th className="py-2 pr-4">Pendiente</th>
                </tr>
              </thead>
              <tbody>
                {remitosVencidos.map((doc) => (
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
                    <td className="py-2 pr-4 text-red-600 dark:text-red-400 font-medium">
                      {doc.dueDate?.toLocaleDateString("es-AR")}
                    </td>
                    <td className="py-2 pr-4">{formatMoney(doc.pending, doc.currency)}</td>
                  </tr>
                ))}
                {remitosVencidos.length === 0 && (
                  <tr>
                    <td colSpan={4} className="py-4 text-center text-foreground/40">
                      No hay remitos vencidos.
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
                  <th className="py-2 pr-4">Cliente</th>
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

        <section>
          <h2 className="text-sm font-semibold mb-2">Clientes con más deuda</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-foreground/10 text-left text-foreground/60">
                  <th className="py-2 pr-4">Cliente</th>
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
                      Todavía no hay clientes cargados.
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
  const [ingresos, rentabilidad, entregado] = await Promise.all([
    getIngresosDelMes(),
    getRentabilidadDelMes(),
    getProductoEntregadoValorizado(),
  ]);

  return (
    <section className="space-y-6">
      <h2 className="text-lg font-semibold">Reportes gerenciales</h2>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-xl border border-foreground/10 bg-background shadow-sm p-4">
          <p className="text-sm font-semibold mb-1">Ingresos del mes</p>
          {ingresos.size === 0 ? (
            <p className="text-2xl font-semibold">{formatMoney(0)}</p>
          ) : (
            Array.from(ingresos.entries()).map(([currency, amount]) => (
              <p key={currency} className="text-2xl font-semibold">
                {formatMoney(amount, currency)}
              </p>
            ))
          )}
          <p className="text-xs text-foreground/50 mt-1">
            suma de comprobantes del mes (remitos, facturas, notas y ajustes), cifra bruta.
          </p>
        </div>
        <div className="rounded-xl border border-foreground/10 bg-background shadow-sm p-4">
          <p className="text-sm font-semibold mb-1">Rentabilidad del mes</p>
          <p className="text-2xl font-semibold">{formatMoney(rentabilidad.rentabilidad)}</p>
          <p className="text-xs text-foreground/50 mt-1">
            ingresos (ARS) menos costo de insumos consumidos en producción. No incluye otros
            costos fijos (mano de obra, alquiler, etc.)
            {rentabilidad.itemsSinCosto > 0 &&
              ` — ${rentabilidad.itemsSinCosto} insumo(s) consumido(s) sin costo unitario cargado, no se descontaron.`}
          </p>
        </div>
        <div className="rounded-xl border border-foreground/10 bg-background shadow-sm p-4 sm:col-span-2">
          <p className="text-sm font-semibold mb-1">Producto entregado valorizado (este mes)</p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-foreground/10 text-left text-foreground/60">
                  <th className="py-2 pr-4">Producto</th>
                  <th className="py-2 pr-4">Cantidad</th>
                  <th className="py-2 pr-4">Monto</th>
                </tr>
              </thead>
              <tbody>
                {entregado.map(({ product, quantity, byCurrency }) => (
                  <tr key={product.id} className="border-b border-foreground/5">
                    <td className="py-2 pr-4">{formatProductLabel(product)}</td>
                    <td className="py-2 pr-4">{formatQuantity(quantity)}</td>
                    <td className="py-2 pr-4">
                      {Array.from(byCurrency.entries())
                        .map(([currency, amount]) => formatMoney(amount, currency))
                        .join(" + ")}
                    </td>
                  </tr>
                ))}
                {entregado.length === 0 && (
                  <tr>
                    <td colSpan={3} className="py-4 text-center text-foreground/40">
                      Sin remitos con producto y cantidad cargados este mes.
                    </td>
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
