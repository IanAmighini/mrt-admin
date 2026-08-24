"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth-helpers";
import type { EntityType } from "@prisma/client";

const ENTITY_TYPES: EntityType[] = ["CLIENTE", "PROVEEDOR", "AMBOS"];

export async function createEntity(formData: FormData) {
  await requireRole(["ADMIN", "CARGA_DIARIA"]);

  const name = String(formData.get("name") || "").trim();
  const type = String(formData.get("type") || "") as EntityType;
  const taxId = String(formData.get("taxId") || "").trim() || null;
  const contact = String(formData.get("contact") || "").trim() || null;
  const isWithholdingAgent = formData.get("isWithholdingAgent") === "on";

  if (!name) {
    throw new Error("El nombre es obligatorio.");
  }
  if (!ENTITY_TYPES.includes(type)) {
    throw new Error("Tipo inválido.");
  }

  await prisma.$transaction(async (tx) => {
    const entity = await tx.entity.create({
      data: { name, type, taxId, contact, isWithholdingAgent },
    });
    await tx.account.createMany({
      data: [
        { entityId: entity.id, circuit: "BLANCO" },
        { entityId: entity.id, circuit: "NEGRO" },
      ],
    });
  });

  revalidatePath("/entidades");
}
