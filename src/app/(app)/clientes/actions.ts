"use server";

import { UserError } from "@/lib/user-error";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth-helpers";
import { logAudit } from "@/lib/audit";
import { generateUniqueSlug } from "@/lib/slug";
import { aplicarSaldoInicial } from "@/lib/saldo-inicial";
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
    throw new UserError("El nombre es obligatorio.");
  }
  if (!ENTITY_TYPES.includes(type)) {
    throw new UserError("Tipo inválido.");
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

    await Promise.all([
      aplicarSaldoInicial(tx, blanco.id, saldoInicialBlancoRaw, user.id),
      aplicarSaldoInicial(tx, negro.id, saldoInicialNegroRaw, user.id),
    ]);

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
  if (!entityId) throw new UserError("Falta la entidad.");

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
  const saldoInicialBlancoRaw = String(formData.get("saldoInicialBlanco") || "").trim();
  const saldoInicialNegroRaw = String(formData.get("saldoInicialNegro") || "").trim();

  if (!name) {
    throw new UserError("El nombre es obligatorio.");
  }
  if (!ENTITY_TYPES.includes(type)) {
    throw new UserError("Tipo inválido.");
  }

  const entity = await prisma.$transaction(async (tx) => {
    const entity = await tx.entity.update({
      where: { id: entityId },
      data: { name, type, taxId, email, phone, address, notes, supplierCategory, isWithholdingAgent },
      include: { accounts: true },
    });

    // La cuenta de un circuito puede no existir en entidades viejas; se saltea en vez de romper.
    for (const [circuit, raw] of [
      ["BLANCO", saldoInicialBlancoRaw],
      ["NEGRO", saldoInicialNegroRaw],
    ] as const) {
      const account = entity.accounts.find((a) => a.circuit === circuit);
      if (account) await aplicarSaldoInicial(tx, account.id, raw, user.id);
    }

    return entity;
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
