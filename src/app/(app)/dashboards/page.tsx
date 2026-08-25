import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth-helpers";
import { getAccountBalance, getVencimientos } from "@/lib/ledger";
import { getAllItemStocks, getAllProductStockLevels } from "@/lib/stock";
import { getIngresosDelMes, getLitrosEnvasados } from "@/lib/reports";
import { formatMoney, formatQuantity } from "@/lib/money";
import { DOCUMENT_TYPE_LABELS } from "@/lib/labels";
import type { EntityType } from "@prisma/client";

async function getEntitySaldos(typeFilter: EntityType[]) {
  const entities = await prisma.entity.findMany({
    where: { type: { in: typeFilter } },
    orderBy: { name: "asc" },
    include: { accounts: true },
  });

  const rows = await Promise.all(
    entities.map(async (entity) => {
      const blanco = entity.accounts.find((a) => a.circuit === "BLANCO");
      const negro = entity.accounts.find((a) => a.circuit === "NEGRO");
      const [blancoSaldo, negroSaldo] = await Promise.all([
        blanco ? getAccountBalance(blanco.id) : null,
        negro ? getAccountBalance(negro.id) : null,
      ]);
      const total = (blancoSaldo?.toNumber() ?? 0) + (negroSaldo?.toNumber() ?? 0);
      return { entity, blancoSaldo, negroSaldo, total };
    })
  );

  return rows.sort((a, b) => b.total - a.total);
}

export default async function DashboardsPage() {
  const user = await requireUser();
  const isAdmin = user.role === "ADMIN";
  const today = new Date();

  const [proveedores, clientes, items, itemStocks, productLevels, vencimientos] =
    await Promise.all([
      getEntitySaldos(["PROVEEDOR", "AMBOS"]),
      getEntitySaldos(["CLIENTE", "AMBOS"]),
      prisma.item.findMany({ orderBy: { name: "asc" } }),
      getAllItemStocks(),
      getAllProductStockLevels(),
      getVencimientos(),
    ]);

  const products = await prisma.product.findMany({ orderBy: { name: "asc" } });

  const vencimientosProveedores = vencimientos.filter((v) =>
    ["PROVEEDOR", "AMBOS"].includes(v.account.entity.type)
  );
  const vencimientosClientes = vencimientos.filter((v) =>
    ["CLIENTE", "AMBOS"].includes(v.account.entity.type)
  );

  return (
    <div className="space-y-12">
      <div>
        <h1 className="text-xl font-semibold mb-1">Dashboards</h1>
        <p className="text-sm text-black/60">
          Insumos/proveedores, producto terminado/clientes
          {isAdmin && " y reportes gerenciales"}.
        </p>
      </div>

      <section className="space-y-6">
        <h2 className="text-lg font-semibold">Insumos y proveedores</h2>

        <div>
          <h3 className="text-sm font-semibold mb-2">Stock de insumos</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-black/10 text-left text-black/60">
                  <th className="py-2 pr-4">Insumo</th>
                  <th className="py-2 pr-4">Stock actual</th>
                  <th className="py-2 pr-4">Stock mínimo</th>
                  <th className="py-2 pr-4"></th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => {
                  const stockDecimal = itemStocks.get(item.id);
                  const bajo =
                    item.minStock != null &&
                    stockDecimal != null &&
                    stockDecimal.lessThan(item.minStock);
                  return (
                    <tr key={item.id} className="border-b border-black/5">
                      <td className="py-2 pr-4">
                        <Link href={`/stock/${item.id}`} className="underline underline-offset-2">
                          {item.name}
                        </Link>
                      </td>
                      <td className="py-2 pr-4">{formatQuantity(stockDecimal ?? 0, item.unit)}</td>
                      <td className="py-2 pr-4">
                        {item.minStock != null ? formatQuantity(item.minStock, item.unit) : "—"}
                      </td>
                      <td className="py-2 pr-4">
                        {bajo && <span className="text-red-600 font-medium">Bajo mínimo</span>}
                      </td>
                    </tr>
                  );
                })}
                {items.length === 0 && (
                  <tr>
                    <td colSpan={4} className="py-6 text-center text-black/40">
                      Todavía no hay insumos cargados.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div>
          <h3 className="text-sm font-semibold mb-2">Cuentas corrientes de proveedores</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-black/10 text-left text-black/60">
                  <th className="py-2 pr-4">Proveedor</th>
                  <th className="py-2 pr-4">Saldo Blanco</th>
                  <th className="py-2 pr-4">Saldo Negro</th>
                  <th className="py-2 pr-4">Total</th>
                </tr>
              </thead>
              <tbody>
                {proveedores.map(({ entity, blancoSaldo, negroSaldo, total }) => (
                  <tr key={entity.id} className="border-b border-black/5">
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
                {proveedores.length === 0 && (
                  <tr>
                    <td colSpan={4} className="py-6 text-center text-black/40">
                      Todavía no hay proveedores cargados.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div>
          <h3 className="text-sm font-semibold mb-2">Vencimientos próximos a pagar</h3>
          <VencimientosTable vencimientos={vencimientosProveedores} today={today} />
        </div>
      </section>

      <section className="space-y-6">
        <h2 className="text-lg font-semibold">Producto terminado y clientes</h2>

        <div>
          <h3 className="text-sm font-semibold mb-2">
            Stock de producto terminado (en unidades equivalentes)
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-black/10 text-left text-black/60">
                  <th className="py-2 pr-4">Producto</th>
                  <th className="py-2 pr-4">Suelto</th>
                  <th className="py-2 pr-4">En cajas</th>
                  <th className="py-2 pr-4">En pallets armados</th>
                </tr>
              </thead>
              <tbody>
                {products.map((product) => {
                  const levels = productLevels.get(product.id);
                  return (
                    <tr key={product.id} className="border-b border-black/5">
                      <td className="py-2 pr-4">
                        <Link
                          href={`/produccion/${product.id}`}
                          className="underline underline-offset-2"
                        >
                          {product.name}
                        </Link>
                      </td>
                      <td className="py-2 pr-4">{formatQuantity(levels?.suelto ?? 0)}</td>
                      <td className="py-2 pr-4">{formatQuantity(levels?.enCajas ?? 0)}</td>
                      <td className="py-2 pr-4">{formatQuantity(levels?.enPallets ?? 0)}</td>
                    </tr>
                  );
                })}
                {products.length === 0 && (
                  <tr>
                    <td colSpan={4} className="py-6 text-center text-black/40">
                      Todavía no hay productos cargados.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div>
          <h3 className="text-sm font-semibold mb-2">Cuentas corrientes de clientes</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-black/10 text-left text-black/60">
                  <th className="py-2 pr-4">Cliente</th>
                  <th className="py-2 pr-4">Saldo Blanco</th>
                  <th className="py-2 pr-4">Saldo Negro</th>
                  <th className="py-2 pr-4">Total</th>
                </tr>
              </thead>
              <tbody>
                {clientes.map(({ entity, blancoSaldo, negroSaldo, total }) => (
                  <tr key={entity.id} className="border-b border-black/5">
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
                {clientes.length === 0 && (
                  <tr>
                    <td colSpan={4} className="py-6 text-center text-black/40">
                      Todavía no hay clientes cargados.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div>
          <h3 className="text-sm font-semibold mb-2">Vencimientos próximos a cobrar</h3>
          <VencimientosTable vencimientos={vencimientosClientes} today={today} />
        </div>
      </section>

      {isAdmin && <ReportesGerenciales />}
    </div>
  );
}

async function ReportesGerenciales() {
  const [litros, ingresos] = await Promise.all([getLitrosEnvasados(), getIngresosDelMes()]);

  return (
    <section className="space-y-6">
      <h2 className="text-lg font-semibold">Reportes gerenciales</h2>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-lg border border-black/10 p-4">
          <p className="text-sm font-semibold mb-1">Litros envasados</p>
          <p className="text-2xl font-semibold">{formatQuantity(litros.esteMes, "L")}</p>
          <p className="text-xs text-black/50 mt-1">
            este mes — {formatQuantity(litros.total, "L")} total histórico
          </p>
        </div>
        <div className="rounded-lg border border-black/10 p-4">
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
          <p className="text-xs text-black/50 mt-1">
            suma de comprobantes del mes (remitos, facturas, notas y ajustes) — no es
            rentabilidad, todavía no se cargan costos unitarios de insumos.
          </p>
        </div>
        <div className="rounded-lg border border-black/10 p-4">
          <p className="text-sm font-semibold mb-1">Valuación de insumos en stock</p>
          <p className="text-sm text-black/40">
            No disponible — falta cargar el costo unitario de cada insumo.
          </p>
        </div>
        <div className="rounded-lg border border-black/10 p-4">
          <p className="text-sm font-semibold mb-1">Producto entregado valorizado</p>
          <p className="text-sm text-black/40">
            No disponible — falta cargar el precio de venta por unidad.
          </p>
        </div>
      </div>
    </section>
  );
}

function VencimientosTable({
  vencimientos,
  today,
}: {
  vencimientos: Awaited<ReturnType<typeof getVencimientos>>;
  today: Date;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-black/10 text-left text-black/60">
            <th className="py-2 pr-4">Entidad</th>
            <th className="py-2 pr-4">Comprobante</th>
            <th className="py-2 pr-4">Vencimiento</th>
            <th className="py-2 pr-4">Pendiente</th>
            <th className="py-2 pr-4">Estado</th>
          </tr>
        </thead>
        <tbody>
          {vencimientos.map((doc) => {
            const vencido = doc.dueDate && doc.dueDate < today;
            return (
              <tr key={doc.id} className="border-b border-black/5">
                <td className="py-2 pr-4">
                  <Link
                    href={`/cuentas-corrientes/${doc.account.entityId}`}
                    className="underline underline-offset-2"
                  >
                    {doc.account.entity.name}
                  </Link>
                </td>
                <td className="py-2 pr-4">
                  {DOCUMENT_TYPE_LABELS[doc.type]} #{doc.number}
                </td>
                <td className="py-2 pr-4">{doc.dueDate?.toLocaleDateString("es-AR")}</td>
                <td className="py-2 pr-4">{formatMoney(doc.pending, doc.currency)}</td>
                <td className="py-2 pr-4">
                  <span className={vencido ? "text-red-600 font-medium" : "text-black/60"}>
                    {vencido ? "Vencido" : "Por vencer"}
                  </span>
                </td>
              </tr>
            );
          })}
          {vencimientos.length === 0 && (
            <tr>
              <td colSpan={5} className="py-4 text-center text-black/40">
                No hay comprobantes con vencimiento pendiente.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
