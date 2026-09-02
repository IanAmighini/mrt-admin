"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth-helpers";
import { toDecimal } from "@/lib/money";
import { logAudit } from "@/lib/audit";
import { generateUniqueSlug } from "@/lib/slug";
import type { EntityType, SupplierCategory } from "@prisma/client";

const ENTITY_TYPES: EntityType[] = ["CLIENTE", "PROVEEDOR", "AMBOS"];
const ENTITY_TYPE_LABELS: Record<EntityType, string> = {
  CLIENTE: "Cliente",
  PROVEEDOR: "Proveedor",
  AMBOS: "Cliente/Proveedor",
  TESORERIA: "Tesorería",
};
const SUPPLIER_CATEGORIES: SupplierCategory[] = [
  "ACEITE",
  "ENVASES",
  "CAJAS",
  "TAPAS",
  "CINTA",
  "ETIQUETAS",
  "PALLET_NORMALIZADO",
  "OTRO",
];

export async function createEntity(formData: FormData) {
  const user = await requireRole(["ADMIN", "SECRETARIA"]);

  const name = String(formData.get("name") || "").trim();
  const type = String(formData.get("type") || "") as EntityType;
  const taxId = String(formData.get("taxId") || "").trim() || null;
  const email = String(formData.get("email") || "").trim() || null;
  const phone = String(formData.get("phone") || "").trim() || null;
  const address = String(formData.get("address") || "").trim() || null;
  const notes = String(formData.get("notes") || "").trim() || null;
  const isWithholdingAgent = formData.get("isWithholdingAgent") === "on";
  const saldoInicialBlancoRaw = String(formData.get("saldoInicialBlanco") || "").trim();
  const saldoInicialNegroRaw = String(formData.get("saldoInicialNegro") || "").trim();
  const supplierCategoryRaw = String(formData.get("supplierCategory") || "").trim();
  const supplierCategory = SUPPLIER_CATEGORIES.includes(supplierCategoryRaw as SupplierCategory)
    ? (supplierCategoryRaw as SupplierCategory)
    : null;

  if (!name) {
    throw new Error("El nombre es obligatorio.");
  }
  if (!ENTITY_TYPES.includes(type)) {
    throw new Error("Tipo inválido.");
  }

  await prisma.$transaction(async (tx) => {
    const slug = await generateUniqueSlug(
      name,
      (candidate) => tx.entity.findUnique({ where: { slug: candidate } }).then(Boolean),
      "entidad"
    );
    const entity = await tx.entity.create({
      data: { name, slug, type, taxId, email, phone, address, notes, supplierCategory, isWithholdingAgent },
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

    await logAudit(tx, {
      userId: user.id,
      action: "CREATE",
      entityType: ENTITY_TYPE_LABELS[type],
      entityId: entity.id,
      summary: `${name}`,
    });
  });

  revalidatePath("/clientes");
  revalidatePath("/proveedores");
}

export async function updateEntity(formData: FormData) {
  const user = await requireRole(["ADMIN", "SECRETARIA"]);

  const entityId = String(formData.get("entityId") || "");
  if (!entityId) throw new Error("Falta la entidad.");

  const name = String(formData.get("name") || "").trim();
  const type = String(formData.get("type") || "") as EntityType;
  const taxId = String(formData.get("taxId") || "").trim() || null;
  const email = String(formData.get("email") || "").trim() || null;
  const phone = String(formData.get("phone") || "").trim() || null;
  const address = String(formData.get("address") || "").trim() || null;
  const notes = String(formData.get("notes") || "").trim() || null;
  const isWithholdingAgent = formData.get("isWithholdingAgent") === "on";
  const supplierCategoryRaw = String(formData.get("supplierCategory") || "").trim();
  const supplierCategory = SUPPLIER_CATEGORIES.includes(supplierCategoryRaw as SupplierCategory)
    ? (supplierCategoryRaw as SupplierCategory)
    : null;

  if (!name) {
    throw new Error("El nombre es obligatorio.");
  }
  if (!ENTITY_TYPES.includes(type)) {
    throw new Error("Tipo inválido.");
  }

  const entity = await prisma.entity.update({
    where: { id: entityId },
    data: { name, type, taxId, email, phone, address, notes, supplierCategory, isWithholdingAgent },
  });

  await logAudit(prisma, {
    userId: user.id,
    action: "UPDATE",
    entityType: ENTITY_TYPE_LABELS[type],
    entityId,
    summary: `${name}`,
  });

  revalidatePath("/clientes");
  revalidatePath("/proveedores");
  revalidatePath(`/cuentas-corrientes/${entity.slug}`);
}
