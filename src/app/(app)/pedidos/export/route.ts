import type { NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth-helpers";
import { getPedidosFiltrados } from "@/lib/pedidos";
import { buildWorkbook, excelResponse, sheet } from "@/lib/excel";
import { PEDIDO_STATUS_LABELS } from "@/lib/labels";
import { formatProductBrandLabel } from "@/lib/product-label";
import { formatFecha, hoyEnInput } from "@/lib/period";

/**
 * La planilla de pedidos para imprimir y tener en producción. Baja lo mismo que muestra la
 * pantalla con los filtros que tenga puestos, una fila por producto pedido.
 */
export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return new Response("No autorizado", { status: 401 });

  const sp = request.nextUrl.searchParams;
  const { pedidos, status } = await getPedidosFiltrados({
    estado: sp.get("estado") ?? undefined,
    entityId: sp.get("entityId") ?? undefined,
    from: sp.get("from") ?? undefined,
    to: sp.get("to") ?? undefined,
  });

  type Fila = { pedido: (typeof pedidos)[number]; line: (typeof pedidos)[number]["lines"][number] };
  const filas: Fila[] = pedidos.flatMap((pedido) => pedido.lines.map((line) => ({ pedido, line })));
  const filtros = [
    status ? `Estado: ${PEDIDO_STATUS_LABELS[status]}` : "Todos los estados",
    sp.get("entityId") && pedidos[0] ? `Cliente: ${pedidos[0].entity.name}` : null,
    sp.get("from") ? `Desde ${sp.get("from")!.split("-").reverse().join("/")}` : null,
    sp.get("to") ? `Hasta ${sp.get("to")!.split("-").reverse().join("/")}` : null,
  ].filter(Boolean);

  const workbook = await buildWorkbook([
    sheet<Fila>({
      name: "Pedidos",
      title: "Pedidos",
      subtitle: [`Impreso el ${formatFecha(new Date())} · ${filtros.join(" · ")}`],
      paraImprimir: true,
      columns: [
        { header: "Fecha", value: (r) => r.pedido.date, format: "date" },
        { header: "Cliente", value: (r) => r.pedido.entity.name, width: 28 },
        { header: "Nº Pedido", value: (r) => r.pedido.orderNumber, width: 12 },
        { header: "Estado", value: (r) => PEDIDO_STATUS_LABELS[r.pedido.status], width: 12 },
        // Sin formato fijo: "5" y "0,5" tal cual, no "5,000".
        { header: "Pallets", value: (r) => r.line.pallets, width: 8 },
        { header: "Producto", value: (r) => formatProductBrandLabel(r.line.product), width: 24 },
        { header: "Formato", value: (r) => r.line.product.presentation, width: 14 },
        { header: "Entrega", value: (r) => r.pedido.deliveryDate, format: "date" },
        { header: "Comentarios", value: (r) => r.pedido.comments ?? "", width: 40 },
      ],
      rows: filas,
    }),
  ]);
  return excelResponse(workbook, `pedidos_${hoyEnInput()}.xlsx`);
}
