"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { UserError } from "@/lib/user-error";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth-helpers";
import { getSetting } from "@/lib/settings";
import { toDecimal } from "@/lib/money";
import { logAudit } from "@/lib/audit";
import { resolveOrCreateProduct } from "@/lib/products";
import { formatProductBrandLabel } from "@/lib/product-label";

/**
 * Deja lista la receta de una marca y un formato que todavía no se produjeron, para revisarla o
 * cambiarla antes de la primera producción. Crea el producto con la receta automática —lo mismo
 * que pasaría al producirlo— y lleva a su ficha, que es donde se edita.
 */
export async function crearRecetaDeCombinacion(formData: FormData) {
  const user = await requireRole(["ADMIN"]);

  const marcaId = String(formData.get("marcaId") || "");
  const formatoId = String(formData.get("formatoId") || "");
  if (!marcaId || !formatoId) throw new UserError("Elegí la marca y el formato.");

  const efficiencyPercent = toDecimal(await getSetting("oilFillEfficiencyPercent", "100"));
  const { product, existia } = await prisma.$transaction(async (tx) => {
    const marca = await tx.marca.findUnique({ where: { id: marcaId } });
    const formato = await tx.formato.findUnique({ where: { id: formatoId } });
    const existia =
      marca && formato
        ? await tx.product.findFirst({
            where: { name: marca.name, oilType: marca.oilType, presentation: formato.presentation },
            select: { id: true, recipe: { select: { id: true } } },
          })
        : null;
    const product = await resolveOrCreateProduct(tx, marcaId, formatoId, efficiencyPercent);
    return { product, existia: Boolean(existia && existia.recipe.length > 0) };
  });

  if (!existia) {
    await logAudit(prisma, {
      userId: user.id,
      action: "CREATE",
      entityType: "Receta",
      entityId: product.id,
      summary: `Receta de ${formatProductBrandLabel(product)} ${product.presentation} — ${product.recipe.length} insumo(s)`,
      cambios: product.recipe.map((r) => ({ campo: r.item.name, antes: null, despues: r.quantityPerUnit.toString() })),
    });
  }

  revalidatePath("/produccion/recetas");
  revalidatePath("/produccion");
  redirect(`/produccion/${product.slug}`);
}
