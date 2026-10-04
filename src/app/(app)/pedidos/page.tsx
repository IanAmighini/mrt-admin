import { Fragment } from "react";
import type { PedidoStatus } from "@prisma/client";
import { Download } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth-helpers";
import { formatNumeroExacto, formatQuantity } from "@/lib/money";
import { formatProductBrandLabel } from "@/lib/product-label";
import { PEDIDO_STATUS_COLORS, PEDIDO_STATUS_LABELS } from "@/lib/labels";
import { FormModal } from "@/components/Modal";
import { DeleteButton } from "@/components/DeleteButton";
import { PedidoFormFields } from "@/components/PedidoFormFields";
import { PedidoStatusSelect } from "@/components/PedidoStatusSelect";
import { FilterBar, FiltroFechas, FiltroSelect } from "@/components/ui/FilterBar";
import { Table, TableEmpty, Td, Th, Thead } from "@/components/ui/Table";
import { createPedido, deletePedido, updatePedido } from "./actions";
import { formatFecha, toDateInputValue } from "@/lib/period";
import { getPedidosFiltrados } from "@/lib/pedidos";

const STATUS_FILTERS: { value: PedidoStatus | ""; label: string }[] = [
  { value: "", label: "Todos" },
  { value: "EN_COLA", label: "En cola" },
  { value: "COMPLETADO", label: "Terminados" },
  { value: "ENTREGADO", label: "Entregados" },
];

export default async function PedidosPage({
  searchParams,
}: {
  searchParams: Promise<{ estado?: string; entityId?: string; from?: string; to?: string }>;
}) {
  const { estado, entityId, from, to } = await searchParams;
  const user = await requireUser();
  const canEdit = user.role === "ADMIN" || user.role === "SECRETARIA";

  const [clientes, marcas, formatos, { pedidos, status, hayFiltro }] = await Promise.all([
    prisma.entity.findMany({
      where: { type: { in: ["CLIENTE", "AMBOS"] } },
      orderBy: { name: "asc" },
    }),
    prisma.marca.findMany({ orderBy: [{ name: "asc" }, { oilType: "asc" }] }),
    prisma.formato.findMany({
      orderBy: [{ bottleCapacityMl: "asc" }, { boxesPerPallet: "asc" }],
      select: { id: true, presentation: true },
    }),
    getPedidosFiltrados({ estado, entityId, from, to }),
  ]);
  const statusFilter = status ?? "";
  // El Excel baja lo mismo que se está mirando: se le pasan los filtros tal cual.
  const exportQuery = new URLSearchParams(
    Object.entries({ estado: statusFilter, entityId, from, to }).filter((e): e is [string, string] => Boolean(e[1]))
  ).toString();

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-xl font-semibold mb-1">Pedidos</h1>
        <p className="text-sm text-foreground/60">
          Pedidos recibidos por WhatsApp. Pasan a &quot;Terminado&quot; solos cuando hay stock
          (producción del día) y a &quot;Entregado&quot; al cargar el remito.
        </p>
      </div>

      <div className="flex flex-wrap gap-3">
        {canEdit && (
          <FormModal triggerLabel="Nuevo pedido" title="Nuevo pedido" action={createPedido} maxWidthClass="max-w-2xl">
            <PedidoFormFields clientes={clientes} marcas={marcas} formatos={formatos} />
          </FormModal>
        )}
        <a
          href={`/pedidos/export${exportQuery ? `?${exportQuery}` : ""}`}
          className="flex w-fit items-center gap-1.5 rounded-lg border border-foreground/20 px-4 py-2 text-sm font-medium transition-colors hover:bg-foreground/5"
        >
          <Download size={16} />
          Descargar Excel
        </a>
      </div>

      <FilterBar limpiarHref="/pedidos" hayFiltro={hayFiltro} textoBoton="Filtrar">
        <FiltroSelect
          label="Cliente"
          name="entityId"
          defaultValue={entityId}
          opciones={clientes.map((c) => ({ value: c.id, label: c.name }))}
          className="w-full sm:w-56"
        />
        <FiltroSelect
          label="Estado"
          name="estado"
          defaultValue={statusFilter}
          opciones={STATUS_FILTERS.filter((s) => s.value).map((s) => ({
            value: s.value,
            label: s.label,
          }))}
        />
        <FiltroFechas from={from} to={to} />
      </FilterBar>

      <Table>
        <Thead>
          <Th>Fecha</Th>
          <Th>Cliente</Th>
          <Th>Nº Pedido</Th>
          <Th>Estado</Th>
          <Th align="derecha">Pallets</Th>
          <Th>Producto</Th>
          <Th>Entrega</Th>
          <Th>Comentarios</Th>
          {canEdit && <Th>Acciones</Th>}
        </Thead>
          <tbody>
            {pedidos.map((pedido, i) => (
              <Fragment key={pedido.id}>
                {pedido.lines.map((line, li) => (
                  <tr
                    key={line.id}
                    className={`border-b border-foreground/5 ${
                      li === 0 && i > 0 ? "border-t border-t-foreground/15" : ""
                    } ${i % 2 === 1 ? "bg-foreground/[0.02]" : ""}`}
                  >
                    {li === 0 && (
                      <>
                        <Td arriba rowSpan={pedido.lines.length} className="whitespace-nowrap">
                          {formatFecha(pedido.date)}
                        </Td>
                        <Td arriba rowSpan={pedido.lines.length}>
                          {pedido.entity.name}
                        </Td>
                        <Td arriba rowSpan={pedido.lines.length}>
                          {pedido.orderNumber}
                        </Td>
                        <Td arriba rowSpan={pedido.lines.length}>
                          {canEdit ? (
                            <PedidoStatusSelect pedidoId={pedido.id} status={pedido.status} />
                          ) : (
                            <span
                              className={`rounded px-2 py-1 text-xs font-medium ${PEDIDO_STATUS_COLORS[pedido.status]}`}
                            >
                              {PEDIDO_STATUS_LABELS[pedido.status]}
                            </span>
                          )}
                        </Td>
                      </>
                    )}
                    <Td numero>{formatQuantity(line.pallets)}</Td>
                    <Td className="whitespace-nowrap">
                      {formatProductBrandLabel(line.product)}
                      <span className="text-foreground/50"> · {line.product.presentation}</span>
                    </Td>
                    {li === 0 && (
                      <>
                        <Td arriba rowSpan={pedido.lines.length} className="whitespace-nowrap">
                          {pedido.deliveryDate ? formatFecha(pedido.deliveryDate) : "—"}
                        </Td>
                        <Td arriba rowSpan={pedido.lines.length} className="text-foreground/60">
                          {pedido.comments || "—"}
                        </Td>
                        {canEdit && (
                          <Td arriba rowSpan={pedido.lines.length}>
                            <div className="flex items-center gap-2">
                              <FormModal
                                triggerLabel="Editar" iconName="edit"
                                title="Editar pedido"
                                action={updatePedido}
                                maxWidthClass="max-w-2xl"
                              >
                                <PedidoFormFields
                                  clientes={clientes}
                                  marcas={marcas}
                                  formatos={formatos}
                                  editingPedidoId={pedido.id}
                                  orderNumber={pedido.orderNumber}
                                  defaultValues={{
                                    entityId: pedido.entityId,
                                    date: toDateInputValue(pedido.date),
                                    comments: pedido.comments ?? "",
                                  }}
                                  defaultRows={pedido.lines.map((line) => ({
                                    marcaId:
                                      marcas.find(
                                        (m) =>
                                          m.name === line.product.name &&
                                          m.oilType === line.product.oilType
                                      )?.id ?? "",
                                    formatoId:
                                      formatos.find(
                                        (f) => f.presentation === line.product.presentation
                                      )?.id ?? "",
                                    pallets: formatNumeroExacto(line.pallets),
                                  }))}
                                />
                              </FormModal>
                              <DeleteButton
                                action={deletePedido}
                                hiddenName="pedidoId"
                                hiddenValue={pedido.id}
                                nombre={`el pedido #${pedido.orderNumber}`}
                              />
                            </div>
                          </Td>
                        )}
                      </>
                    )}
                  </tr>
                ))}
              </Fragment>
            ))}
            {pedidos.length === 0 && (
              <TableEmpty colSpan={canEdit ? 9 : 8}>
                {hayFiltro ? "No hay pedidos con este filtro." : "Todavía no hay pedidos cargados."}
              </TableEmpty>
            )}
          </tbody>
        </Table>
    </div>
  );
}
