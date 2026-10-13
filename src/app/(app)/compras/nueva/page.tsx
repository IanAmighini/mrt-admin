import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth-helpers";
import { createCompra, createGasto } from "@/app/(app)/cuentas-corrientes/[entityId]/actions";
import { CargarCompraOGasto, type Tipo } from "@/components/CargarCompraOGasto";
import { compareItemsBySize } from "@/lib/item-order";
import { rubroLabel } from "@/lib/rubro-proveedor";

/**
 * Lo que se le compra a un proveedor, insumos o un gasto, desde una sola pantalla. `?tipo=gasto`
 * abre directo en gasto; `?entityId=` llega con el proveedor elegido (desde su ficha).
 */
export default async function NuevaCompraPage({
  searchParams,
}: {
  searchParams: Promise<{ entityId?: string; tipo?: string }>;
}) {
  const { entityId, tipo } = await searchParams;
  const user = await requireUser();
  const canEdit = user.role === "ADMIN" || user.role === "SECRETARIA";

  const [proveedores, items, subcuentas] = await Promise.all([
    prisma.entity.findMany({
      where: { type: { in: ["PROVEEDOR", "AMBOS"] } },
      orderBy: { name: "asc" },
    }),
    prisma.item.findMany({ orderBy: { name: "asc" } }),
    // Los que dividen su cuenta (Goloeste: alquiler y gastos comunes), para asignar el gasto a una parte.
    prisma.entity.findMany({
      where: { type: { in: ["PROVEEDOR", "AMBOS"] }, llevaViajes: true },
      select: {
        id: true,
        rotuloSubcuenta: true,
        entregas: { select: { id: true, nombre: true, destino: true }, orderBy: [{ fecha: "desc" }, { createdAt: "desc" }] },
      },
    }),
  ]);

  // El desplegable agrupa por categoría, así que dentro de cada una conviene el orden por tamaño y
  // no el alfabético, que pondría "Caja Lisa 12x1500" antes que "Caja Lisa 12x900".
  items.sort(compareItemsBySize);

  const desde = entityId ? proveedores.find((p) => p.id === entityId) : undefined;
  const volverA = desde ? `/cuentas-corrientes/${desde.slug}` : "/compras";

  async function guardarCompra(formData: FormData) {
    "use server";
    await createCompra(formData);
    redirect(volverA);
  }
  async function guardarGasto(formData: FormData) {
    "use server";
    await createGasto(formData);
    redirect(volverA);
  }

  const tipoInicial: Tipo | undefined = tipo === "gasto" ? "GASTO" : tipo === "compra" ? "COMPRA" : undefined;

  return (
    <div className="max-w-5xl space-y-6">
      <div>
        <Link href={volverA} className="text-sm underline underline-offset-2">
          ← {desde ? `Volver a ${desde.name}` : "Volver a compras y gastos"}
        </Link>
        <h1 className="text-xl font-semibold mt-2">Nueva compra o gasto</h1>
      </div>

      {!canEdit && <p className="text-sm text-foreground/60">No tenés permisos para cargar compras.</p>}

      {canEdit && (
        <CargarCompraOGasto
          compraAction={guardarCompra}
          gastoAction={guardarGasto}
          tipoInicial={tipoInicial}
          proveedorInicial={desde?.id}
          proveedores={proveedores.map((p) => ({
            id: p.id,
            name: p.name,
            moneda: p.moneda,
            tipoHabitual: p.supplierCategory ? "COMPRA" : p.expenseCategory ? "GASTO" : null,
            expenseCategory: p.expenseCategory,
            rubro: rubroLabel(p),
          }))}
          items={items.map((i) => ({
            id: i.id,
            name: i.name,
            unit: i.unit,
            category: i.category,
            unitsPerPallet: i.unitsPerPallet,
            precioSopladoUsd: i.precioSopladoUsd ? i.precioSopladoUsd.toString() : null,
          }))}
          subcuentasPorProveedor={Object.fromEntries(
            subcuentas.map((e) => [e.id, { viajes: e.entregas, rotulo: e.rotuloSubcuenta ?? "Subcuenta" }])
          )}
        />
      )}
    </div>
  );
}
