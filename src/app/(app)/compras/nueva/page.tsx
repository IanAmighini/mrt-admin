import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth-helpers";
import { createCompra } from "@/app/(app)/cuentas-corrientes/[entityId]/actions";
import { NuevaCompraForm } from "@/components/NuevaCompraForm";

async function submitCompra(formData: FormData) {
  "use server";
  await createCompra(formData);
  redirect("/compras");
}

export default async function NuevaCompraPage() {
  const user = await requireUser();
  const canEdit = user.role === "ADMIN" || user.role === "SECRETARIA";

  const [proveedores, items] = await Promise.all([
    prisma.entity.findMany({
      where: { type: { in: ["PROVEEDOR", "AMBOS"] } },
      orderBy: { name: "asc" },
    }),
    prisma.item.findMany({ orderBy: { name: "asc" } }),
  ]);

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <Link href="/compras" className="text-sm underline underline-offset-2">
          ← Volver a compras
        </Link>
        <h1 className="text-xl font-semibold mt-2">Nueva compra</h1>
      </div>

      {!canEdit && <p className="text-sm text-foreground/60">No tenés permisos para cargar compras.</p>}

      {canEdit && (
        <NuevaCompraForm
          action={submitCompra}
          proveedores={proveedores.map((p) => ({ id: p.id, name: p.name }))}
          items={items.map((i) => ({ id: i.id, name: i.name, unit: i.unit }))}
        />
      )}
    </div>
  );
}
