import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth-helpers";
import { createCompra } from "@/app/(app)/cuentas-corrientes/[entityId]/actions";
import { NuevaCompraForm } from "@/components/NuevaCompraForm";
import { compareItemsBySize } from "@/lib/item-order";

export default async function NuevaCompraPage({
  searchParams,
}: {
  searchParams: Promise<{ entityId?: string }>;
}) {
  const { entityId: fixedEntityId } = await searchParams;
  const user = await requireUser();
  const canEdit = user.role === "ADMIN" || user.role === "SECRETARIA";

  const [proveedores, items] = await Promise.all([
    prisma.entity.findMany({
      where: { type: { in: ["PROVEEDOR", "AMBOS"] } },
      orderBy: { name: "asc" },
    }),
    prisma.item.findMany({ orderBy: { name: "asc" } }),
  ]);

  // El desplegable agrupa por categoría, así que dentro de cada una conviene el orden por tamaño y
  // no el alfabético, que pondría "Caja Lisa 12x1500" antes que "Caja Lisa 12x900".
  items.sort(compareItemsBySize);

  const fixedEntity = fixedEntityId ? proveedores.find((p) => p.id === fixedEntityId) : undefined;

  async function submitCompra(formData: FormData) {
    "use server";
    await createCompra(formData);
    redirect(fixedEntity ? `/cuentas-corrientes/${fixedEntity.slug}` : "/compras");
  }

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <Link
          href={fixedEntity ? `/cuentas-corrientes/${fixedEntity.slug}` : "/compras"}
          className="text-sm underline underline-offset-2"
        >
          ← {fixedEntity ? `Volver a ${fixedEntity.name}` : "Volver a compras"}
        </Link>
        <h1 className="text-xl font-semibold mt-2">Nueva compra</h1>
      </div>

      {!canEdit && <p className="text-sm text-foreground/60">No tenés permisos para cargar compras.</p>}

      {canEdit && (
        <NuevaCompraForm
          action={submitCompra}
          proveedores={proveedores.map((p) => ({ id: p.id, name: p.name }))}
          items={items.map((i) => ({ id: i.id, name: i.name, unit: i.unit, category: i.category }))}
          fixedEntity={fixedEntity ? { id: fixedEntity.id, name: fixedEntity.name } : undefined}
        />
      )}
    </div>
  );
}
