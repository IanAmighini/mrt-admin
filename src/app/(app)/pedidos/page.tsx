import Link from "next/link";
import { Fragment } from "react";
import type { PedidoStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth-helpers";
import { formatQuantity } from "@/lib/money";
import { formatProductBrandLabel } from "@/lib/product-label";
import { PEDIDO_STATUS_COLORS, PEDIDO_STATUS_LABELS } from "@/lib/labels";
import { FormModal } from "@/components/Modal";
import { DeleteButton } from "@/components/DeleteButton";
import { PedidoFormFields } from "@/components/PedidoFormFields";
import { PedidoStatusSelect } from "@/components/PedidoStatusSelect";
import { createPedido, deletePedido, updatePedido } from "./actions";

function toDateInputValue(date: Date): string {
  return date.toISOString().slice(0, 10);
}

const STATUS_FILTERS: { value: PedidoStatus | ""; label: string }[] = [
  { value: "", label: "Todos" },
  { value: "EN_COLA", label: "En cola" },
  { value: "COMPLETADO", label: "Completados" },
  { value: "ENTREGADO", label: "Entregados" },
];

export default async function PedidosPage({
  searchParams,
}: {
  searchParams: Promise<{ estado?: string; entityId?: string }>;
}) {
  const { estado, entityId } = await searchParams;
  const user = await requireUser();
  const canEdit = user.role === "ADMIN" || user.role === "CARGA_DIARIA";

  const statusFilter = STATUS_FILTERS.some((s) => s.value === estado)
    ? (estado as PedidoStatus | "")
    : "";

  const [clientes, products, pedidos] = await Promise.all([
    prisma.entity.findMany({
      where: { type: { in: ["CLIENTE", "AMBOS"] } },
      orderBy: { name: "asc" },
    }),
    prisma.product.findMany({ orderBy: { name: "asc" } }),
    prisma.pedido.findMany({
      where: {
        ...(statusFilter ? { status: statusFilter } : {}),
        ...(entityId ? { entityId } : {}),
      },
      include: { entity: true, lines: { include: { product: true } } },
      orderBy: { date: "desc" },
    }),
  ]);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-xl font-semibold mb-1">Pedidos</h1>
        <p className="text-sm text-foreground/60">
          Pedidos recibidos por WhatsApp — en cola de producción, completados (en stock, sin
          retirar) y entregados.
        </p>
      </div>

      {canEdit && (
        <FormModal triggerLabel="Nuevo pedido" title="Nuevo pedido" action={createPedido} maxWidthClass="max-w-2xl">
          <PedidoFormFields clientes={clientes} products={products} />
        </FormModal>
      )}

      <div className="flex flex-wrap items-end gap-4">
        <div className="flex flex-wrap gap-1">
          {STATUS_FILTERS.map((s) => (
            <Link
              key={s.value}
              href={{
                pathname: "/pedidos",
                query: { ...(s.value ? { estado: s.value } : {}), ...(entityId ? { entityId } : {}) },
              }}
              className={`rounded px-3 py-1.5 text-sm ${
                statusFilter === s.value
                  ? "bg-primary text-primary-foreground"
                  : "border border-foreground/20 hover:bg-foreground/5"
              }`}
            >
              {s.label}
            </Link>
          ))}
        </div>
        <form className="flex items-end gap-2">
          {statusFilter && <input type="hidden" name="estado" value={statusFilter} />}
          <div className="space-y-1">
            <label className="text-sm" htmlFor="entityId">
              Cliente
            </label>
            <select
              id="entityId"
              name="entityId"
              defaultValue={entityId ?? ""}
              className="w-56 rounded-lg border border-foreground/20 bg-background transition-colors focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary px-3 py-2 text-sm"
            >
              <option value="">— Todos —</option>
              {clientes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <button
            type="submit"
            className="rounded-lg border border-foreground/20 bg-background transition-colors focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary px-3 py-2 text-sm hover:bg-foreground/5"
          >
            Filtrar
          </button>
        </form>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-foreground/10 text-left text-foreground/60">
              <th className="py-2 pr-4">Fecha</th>
              <th className="py-2 pr-4">Cliente</th>
              <th className="py-2 pr-4">Nº Pedido</th>
              <th className="py-2 pr-4">Estado</th>
              <th className="py-2 pr-4">Pallets</th>
              <th className="py-2 pr-4">Formato</th>
              <th className="py-2 pr-4">Etiqueta</th>
              <th className="py-2 pr-4">Entrega</th>
              <th className="py-2 pr-4">Comentarios</th>
              {canEdit && <th className="py-2 pr-4">Acciones</th>}
            </tr>
          </thead>
          <tbody>
            {pedidos.map((pedido, i) => (
              <Fragment key={pedido.id}>
                {pedido.lines.map((line, li) => (
                  <tr
                    key={line.id}
                    className={`border-b border-foreground/5 ${i % 2 === 1 ? "bg-foreground/[0.02]" : ""}`}
                  >
                    {li === 0 && (
                      <>
                        <td className="py-2 pr-4 align-top" rowSpan={pedido.lines.length}>
                          {pedido.date.toLocaleDateString("es-AR")}
                        </td>
                        <td className="py-2 pr-4 align-top" rowSpan={pedido.lines.length}>
                          {pedido.entity.name}
                        </td>
                        <td className="py-2 pr-4 align-top" rowSpan={pedido.lines.length}>
                          {pedido.orderNumber}
                        </td>
                        <td className="py-2 pr-4 align-top" rowSpan={pedido.lines.length}>
                          {canEdit ? (
                            <PedidoStatusSelect pedidoId={pedido.id} status={pedido.status} />
                          ) : (
                            <span
                              className={`rounded px-2 py-1 text-xs font-medium ${PEDIDO_STATUS_COLORS[pedido.status]}`}
                            >
                              {PEDIDO_STATUS_LABELS[pedido.status]}
                            </span>
                          )}
                        </td>
                      </>
                    )}
                    <td className="py-2 pr-4">{formatQuantity(line.pallets, "pallets")}</td>
                    <td className="py-2 pr-4">{line.product.presentation}</td>
                    <td className="py-2 pr-4">{formatProductBrandLabel(line.product)}</td>
                    {li === 0 && (
                      <>
                        <td className="py-2 pr-4 align-top" rowSpan={pedido.lines.length}>
                          {pedido.deliveryDate ? pedido.deliveryDate.toLocaleDateString("es-AR") : "—"}
                        </td>
                        <td className="py-2 pr-4 align-top" rowSpan={pedido.lines.length}>
                          {pedido.comments || "—"}
                        </td>
                        {canEdit && (
                          <td className="py-2 pr-4 align-top" rowSpan={pedido.lines.length}>
                            <div className="flex flex-col gap-1">
                              <FormModal
                                triggerLabel="Editar" iconName="edit"
                                title="Editar pedido"
                                action={updatePedido}
                                maxWidthClass="max-w-2xl"
                              >
                                <PedidoFormFields
                                  clientes={clientes}
                                  products={products}
                                  editingPedidoId={pedido.id}
                                  defaultValues={{
                                    entityId: pedido.entityId,
                                    date: toDateInputValue(pedido.date),
                                    orderNumber: pedido.orderNumber,
                                    comments: pedido.comments ?? "",
                                    lines: pedido.lines.map((l) => ({
                                      productId: l.productId,
                                      pallets: l.pallets.toString(),
                                    })),
                                  }}
                                />
                              </FormModal>
                              <DeleteButton
                                action={deletePedido}
                                hiddenName="pedidoId"
                                hiddenValue={pedido.id}
                                confirmMessage="¿Borrar este pedido? Esta acción no se puede deshacer."
                              />
                            </div>
                          </td>
                        )}
                      </>
                    )}
                  </tr>
                ))}
              </Fragment>
            ))}
            {pedidos.length === 0 && (
              <tr>
                <td colSpan={canEdit ? 10 : 9} className="py-6 text-center text-foreground/40">
                  No hay pedidos cargados{statusFilter || entityId ? " con este filtro." : "."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
