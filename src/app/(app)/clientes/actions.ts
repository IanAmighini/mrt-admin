"use server";

import { UserError } from "@/lib/user-error";
import { reimputarEntidades } from "@/lib/imputacion";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth-helpers";
import { diffDeCampos, logAudit } from "@/lib/audit";
import { asegurarSinNegativos } from "@/lib/sin-negativos";
import { generateUniqueSlug } from "@/lib/slug";
import { aplicarSaldoInicial, NUMERO_SALDO_INICIAL } from "@/lib/saldo-inicial";
import { parseRubro, rubroLabel } from "@/lib/rubro-proveedor";
import type { EntityType, ExpenseCategory, SupplierCategory } from "@prisma/client";

const ENTITY_TYPES: EntityType[] = ["CLIENTE", "PROVEEDOR", "AMBOS"];
const ENTITY_TYPE_LABELS: Record<EntityType, string> = {
  CLIENTE: "Cliente",
  PROVEEDOR: "Proveedor",
  AMBOS: "Cliente/Proveedor",
  TESORERIA: "Tesorería",
};
/**
 * Los campos de un cliente o proveedor que valen la pena en el detalle de Actividad, con el nombre
 * que les pone la pantalla. Lo que no está acá no se compara.
 */
const CAMPOS_DE_LA_ENTIDAD = {
  name: "Nombre",
  tipo: "Tipo",
  taxId: "CUIT",
  rubro: "Rubro",
  email: "Email",
  phone: "Tel\u00e9fono",
  address: "Direcci\u00f3n",
  notes: "Notas",
  isWithholdingAgent: "Agente de retenci\u00f3n",
  llevaCuentaPreformas: "Cuenta de preformas",
  llevaViajes: "Lleva viajes",
  rotuloSubcuenta: "R\u00f3tulo de subcuenta",
  moneda: "Moneda",
  retiroSocietario: "Retiro societario",
} as const;

/** La entidad en la forma que compara `diffDeCampos`. */
function fotoDeLaEntidad(e: {
  name: string;
  type: EntityType;
  taxId: string | null;
  supplierCategory: SupplierCategory | null;
  expenseCategory: ExpenseCategory | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  notes: string | null;
  isWithholdingAgent: boolean;
  llevaCuentaPreformas: boolean;
  llevaViajes: boolean;
  rotuloSubcuenta: string | null;
  moneda: string;
  retiroSocietario: boolean;
}) {
  return {
    name: e.name,
    tipo: ENTITY_TYPE_LABELS[e.type],
    taxId: e.taxId,
    rubro: rubroLabel(e),
    email: e.email,
    phone: e.phone,
    address: e.address,
    notes: e.notes,
    isWithholdingAgent: e.isWithholdingAgent,
    llevaCuentaPreformas: e.llevaCuentaPreformas,
    llevaViajes: e.llevaViajes,
    rotuloSubcuenta: e.rotuloSubcuenta,
    moneda: e.moneda,
    retiroSocietario: e.retiroSocietario,
  };
}

export async function createEntity(formData: FormData) {
  const user = await requireRole(["ADMIN", "SECRETARIA"]);

  // Los espacios de más se limpian: "Tablada Goma  de Dattola" con dos espacios parecía otro nombre.
  const name = String(formData.get("name") || "").replace(/\s+/g, " ").trim();
  const type = String(formData.get("type") || "") as EntityType;
  const taxId = String(formData.get("taxId") || "").trim() || null;
  const email = String(formData.get("email") || "").trim() || null;
  const phone = String(formData.get("phone") || "").trim() || null;
  const address = String(formData.get("address") || "").trim() || null;
  const notes = String(formData.get("notes") || "").trim() || null;
  const isWithholdingAgent = formData.get("isWithholdingAgent") === "on";
  const llevaCuentaPreformas = formData.get("llevaCuentaPreformas") !== null;
  const llevaViajes = formData.get("llevaViajes") !== null;
  const rotuloSubcuenta = String(formData.get("rotuloSubcuenta") || "").trim() || null;
  const moneda = formData.get("cuentaEnDolares") !== null ? "USD" : "ARS";
  const saldoInicialBlancoRaw = String(formData.get("saldoInicialBlanco") || "").trim();
  const saldoInicialNegroRaw = String(formData.get("saldoInicialNegro") || "").trim();
  const { supplierCategory, expenseCategory } = parseRubro(String(formData.get("rubro") || "").trim());

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
      data: {
        // `retiroSocietario` no está: un proveedor nuevo nunca nace siendo por donde se retira
        // para los socios. Se prende editándolo, y sólo lo ve Admin.
        name, slug, type, taxId, email, phone, address, notes, supplierCategory, expenseCategory,
        isWithholdingAgent, llevaCuentaPreformas, llevaViajes, rotuloSubcuenta, moneda,
      },
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
      cambios: diffDeCampos(null, fotoDeLaEntidad(entity), CAMPOS_DE_LA_ENTIDAD),
    });
  });

  revalidatePath("/clientes");
  revalidatePath("/proveedores");
}

export async function updateEntity(formData: FormData) {
  const user = await requireRole(["ADMIN", "SECRETARIA"]);

  const entityId = String(formData.get("entityId") || "");
  if (!entityId) throw new UserError("Falta la entidad.");

  // Los espacios de más se limpian: "Tablada Goma  de Dattola" con dos espacios parecía otro nombre.
  const name = String(formData.get("name") || "").replace(/\s+/g, " ").trim();
  const type = String(formData.get("type") || "") as EntityType;
  const taxId = String(formData.get("taxId") || "").trim() || null;
  const email = String(formData.get("email") || "").trim() || null;
  const phone = String(formData.get("phone") || "").trim() || null;
  const address = String(formData.get("address") || "").trim() || null;
  const notes = String(formData.get("notes") || "").trim() || null;
  const isWithholdingAgent = formData.get("isWithholdingAgent") === "on";
  const llevaCuentaPreformas = formData.get("llevaCuentaPreformas") !== null;
  const llevaViajes = formData.get("llevaViajes") !== null;
  const rotuloSubcuenta = String(formData.get("rotuloSubcuenta") || "").trim() || null;
  // Sólo se toca si el formulario traía la casilla —ahí "no vino" significa "no la cambies", no
  // "apagala"— y sólo si quien guarda es Admin: esconderla en la pantalla no alcanza, porque un
  // formulario se puede armar a mano.
  const retiroSocietario =
    user.role !== "ADMIN" || formData.get("retiroSocietarioPresente") === null
      ? undefined
      : formData.get("retiroSocietario") !== null;
  const moneda = formData.get("cuentaEnDolares") !== null ? "USD" : "ARS";
  const { supplierCategory, expenseCategory } = parseRubro(String(formData.get("rubro") || "").trim());
  const saldoInicialBlancoRaw = String(formData.get("saldoInicialBlanco") || "").trim();
  const saldoInicialNegroRaw = String(formData.get("saldoInicialNegro") || "").trim();

  if (!name) {
    throw new UserError("El nombre es obligatorio.");
  }
  if (!ENTITY_TYPES.includes(type)) {
    throw new UserError("Tipo inválido.");
  }

  const previa = await prisma.entity.findUnique({ where: { id: entityId } });
  if (!previa) throw new UserError("El cliente o proveedor ya no existe.");

  const entity = await prisma.$transaction(async (tx) => {
    const entity = await tx.entity.update({
      where: { id: entityId },
      data: {
        name, type, taxId, email, phone, address, notes, supplierCategory, expenseCategory,
        isWithholdingAgent, llevaCuentaPreformas, llevaViajes, rotuloSubcuenta, moneda,
        ...(retiroSocietario !== undefined ? { retiroSocietario } : {}),
      },
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

    // Bajarle el saldo inicial a una caja puede dejar en rojo todo lo que se pagó después.
    await asegurarSinNegativos(tx, { cuentas: entity.accounts.map((a) => a.id) });

    return entity;
  });

  await logAudit(prisma, {
    userId: user.id,
    action: "UPDATE",
    entityType: ENTITY_TYPE_LABELS[type],
    entityId,
    summary: `${name}`,
    cambios: diffDeCampos(fotoDeLaEntidad(previa), fotoDeLaEntidad(entity), CAMPOS_DE_LA_ENTIDAD),
  });

  // El saldo inicial pudo cambiar, y con él a qué comprobantes cancelan los cobros.
  await reimputarEntidades(entityId);
  revalidatePath("/clientes");
  revalidatePath("/proveedores");
  revalidatePath(`/cuentas-corrientes/${entity.slug}`);
}

/**
 * Borra un cliente o proveedor **solo si no tiene historial**. Si tiene, no se borra: sus
 * comprobantes y pagos son la cuenta corriente, y hacerlos desaparecer descuadraría la contabilidad
 * sin dejar rastro. El error dice exactamente qué lo está reteniendo.
 *
 * La excepción es el saldo inicial, que se borra junto con la entidad: no es un movimiento real,
 * es el número con el que arrancó la cuenta, y ya se puede vaciar desde el formulario de edición.
 * Si tiene pagos imputados encima, deja de ser una excepción y frena como cualquier otro.
 */
export async function deleteEntity(formData: FormData) {
  const user = await requireRole(["ADMIN", "SECRETARIA"]);

  const entityId = String(formData.get("entityId") || "");
  if (!entityId) throw new UserError("Falta la entidad.");

  const entity = await prisma.entity.findUnique({
    where: { id: entityId },
    include: {
      accounts: {
        include: {
          documents: { select: { id: true, number: true, _count: { select: { allocations: true } } } },
          payments: { select: { id: true } },
        },
      },
      prices: { select: { id: true } },
      pedidos: { select: { id: true } },
      entregasPreforma: { select: { id: true } },
      treasuryPayments: { select: { id: true } },
    },
  });
  if (!entity) throw new UserError("El cliente o proveedor ya no existe.");

  const documentos = entity.accounts.flatMap((a) => a.documents);
  const saldosIniciales = documentos.filter(
    (d) => d.number === NUMERO_SALDO_INICIAL && d._count.allocations === 0
  );
  const otrosDocumentos = documentos.length - saldosIniciales.length;
  const pagos = entity.accounts.reduce((n, a) => n + a.payments.length, 0);

  const retenido = [
    otrosDocumentos > 0 && `${otrosDocumentos} comprobante(s)`,
    pagos > 0 && `${pagos} pago(s)`,
    entity.prices.length > 0 && `${entity.prices.length} precio(s)`,
    entity.pedidos.length > 0 && `${entity.pedidos.length} pedido(s)`,
    entity.entregasPreforma.length > 0 && `${entity.entregasPreforma.length} entrega(s) de preformas`,
    entity.treasuryPayments.length > 0 && `${entity.treasuryPayments.length} cobro/pago(s) que lo usan como destino`,
  ].filter(Boolean) as string[];

  if (retenido.length > 0) {
    throw new UserError(
      `No se puede borrar "${entity.name}": tiene ${retenido.join(", ")}. Borrá primero esos movimientos, o dejalo como está — su cuenta corriente es parte de la contabilidad.`
    );
  }

  await prisma.$transaction(async (tx) => {
    await tx.document.deleteMany({ where: { id: { in: saldosIniciales.map((d) => d.id) } } });
    await tx.account.deleteMany({ where: { entityId } });
    await tx.entity.delete({ where: { id: entityId } });

    await logAudit(tx, {
      userId: user.id,
      action: "DELETE",
      entityType: ENTITY_TYPE_LABELS[entity.type],
      entityId,
      summary: entity.name,
      cambios: diffDeCampos(fotoDeLaEntidad(entity), null, CAMPOS_DE_LA_ENTIDAD),
    });
  });

  revalidatePath("/clientes");
  revalidatePath("/proveedores");
  redirect(entity.type === "PROVEEDOR" ? "/proveedores" : "/clientes");
}
