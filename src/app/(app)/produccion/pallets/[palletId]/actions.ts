"use server";

import { revalidatePath } from "next/cache";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth-helpers";

export async function dismantlePallet(formData: FormData) {
  const user = await requireRole(["ADMIN", "CARGA_DIARIA"]);

  const palletId = String(formData.get("palletId") || "");
  const pallet = await prisma.pallet.findUnique({
    where: { id: palletId },
    include: { boxes: true },
  });
  if (!pallet) notFound();
  if (pallet.status !== "ARMADO") {
    throw new Error("Este pallet ya está desarmado.");
  }

  const dateLabel = new Date().toLocaleDateString("es-AR");

  await prisma.$transaction(async (tx) => {
    await tx.pallet.update({
      where: { id: pallet.id },
      data: { status: "DESARMADO", dismantledAt: new Date() },
    });

    for (const box of pallet.boxes) {
      await tx.boxMovement.create({
        data: {
          boxTypeId: box.boxTypeId,
          date: new Date(),
          quantity: box.quantity,
          type: "DEVUELTO_PALLET",
          reason: `Desarmado de pallet ${pallet.label ? `"${pallet.label}" ` : ""}del ${dateLabel}`,
          createdById: user.id,
        },
      });
    }
  });

  revalidatePath(`/produccion/pallets/${pallet.id}`);
  revalidatePath("/produccion");
}
