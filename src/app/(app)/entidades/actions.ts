"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth-helpers";
import { toDecimal } from "@/lib/money";
import type { EntityType } from "@prisma/client";

const ENTITY_TYPES: EntityType[] = ["CLIENTE", "PROVEEDOR", "AMBOS"];

export async function createEntity(formData: FormData) {
  const user = await requireRole(["ADMIN", "CARGA_DIARIA"]);

  const name = String(formData.get("name") || "").trim();
  const type = String(formData.get("type") || "") as EntityType;
  const taxId = String(formData.get("taxId") || "").trim() || null;
  const contact = String(formData.get("contact") || "").trim() || null;
  const isWithholdingAgent = formData.get("isWithholdingAgent") === "on";
  const saldoInicialBlancoRaw = String(formData.get("saldoInicialBlanco") || "").trim();
  const saldoInicialNegroRaw = String(formData.get("saldoInicialNegro") || "").trim();

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
    const [blanco, negro] = await Promise.all([
      tx.account.create({ data: { entityId: entity.id, circuit: "BLANCO" } }),
      tx.account.create({ data: { entityId: entity.id, circuit: "NEGRO" } }),
    ]);

    const today = new Date();
    for (const [account, raw] of [
      [blanco, saldoInicialBlancoRaw],
      [negro, saldoInicialNegroRaw],
    ] as const) {
      if (!raw) continue;
      const amount = toDecimal(raw);
      if (amount.isZero()) continue;
      await tx.document.create({
        data: {
          accountId: account.id,
          type: "AJUSTE",
          number: "SALDO-INICIAL",
          date: today,
          currency: "ARS",
          netAmount: amount,
          totalAmount: amount,
          reason: "Saldo inicial",
          createdById: user.id,
        },
      });
    }
  });

  revalidatePath("/entidades");
}
