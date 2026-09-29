"use server";

import { revalidatePath } from "next/cache";
import { UserError } from "@/lib/user-error";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth-helpers";
import { logAudit } from "@/lib/audit";

function parseFecha(value: FormDataEntryValue | null): Date {
  const str = String(value || "");
  if (!str) throw new UserError("Falta la fecha.");
  return new Date(`${str}T00:00:00`);
}

async function getEntidad(entityId: string) {
  const entity = await prisma.entity.findUnique({ where: { id: entityId } });
  if (!entity) throw new UserError("La entidad ya no existe.");
  return entity;
}

/**
 * Un viaje: el camión que sale con varios remitos para distintos destinatarios. Lo que aporta no
 * es el nombre sino la bolsa: los comprobantes y los pagos que cuelgan de él se imputan entre
 * ellos y no contra el resto de la cuenta.
 */
export async function crearEntrega(formData: FormData) {
  const user = await requireRole(["ADMIN", "SECRETARIA"]);

  const entityId = String(formData.get("entityId") || "");
  const entity = await getEntidad(entityId);

  const nombre = String(formData.get("nombre") || "").trim();
  if (!nombre) throw new UserError("Ponele un nombre al viaje, por ejemplo “Camión 4”.");
  const destino = String(formData.get("destino") || "").trim() || null;
  const notas = String(formData.get("notas") || "").trim() || null;
  const fecha = parseFecha(formData.get("fecha"));

  const entrega = await prisma.entrega.create({
    data: { entityId, nombre, destino, fecha, notas, createdById: user.id },
  });

  await logAudit(prisma, {
    userId: user.id,
    action: "CREATE",
    entityType: "Viaje",
    entityId: entrega.id,
    summary: `${nombre}${destino ? ` · ${destino}` : ""} — ${entity.name}`,
  });

  revalidatePath(`/cuentas-corrientes/${entity.slug}`);
}

export async function actualizarEntrega(formData: FormData) {
  const user = await requireRole(["ADMIN", "SECRETARIA"]);

  const entregaId = String(formData.get("entregaId") || "");
  const entrega = await prisma.entrega.findUnique({
    where: { id: entregaId },
    include: { entity: true },
  });
  if (!entrega) throw new UserError("El viaje ya no existe.");

  const nombre = String(formData.get("nombre") || "").trim();
  if (!nombre) throw new UserError("El nombre es obligatorio.");

  await prisma.entrega.update({
    where: { id: entregaId },
    data: {
      nombre,
      destino: String(formData.get("destino") || "").trim() || null,
      notas: String(formData.get("notas") || "").trim() || null,
      fecha: parseFecha(formData.get("fecha")),
    },
  });

  await logAudit(prisma, {
    userId: user.id,
    action: "UPDATE",
    entityType: "Viaje",
    entityId: entregaId,
    summary: `${nombre} — ${entrega.entity.name}`,
  });

  revalidatePath(`/cuentas-corrientes/${entrega.entity.slug}`);
  revalidatePath(`/cuentas-corrientes/${entrega.entity.slug}/entrega/${entregaId}`);
}

/**
 * Se niega a borrar un viaje que tenga algo adentro. La clave foránea está en SET NULL, así que
 * borrarlo igual no perdería un comprobante — pero los dejaría sueltos en la cuenta y mezclados
 * con el resto, que es exactamente el desorden que el viaje viene a evitar, y sin manera de
 * saber cuáles eran.
 */
export async function borrarEntrega(formData: FormData) {
  const user = await requireRole(["ADMIN", "SECRETARIA"]);

  const entregaId = String(formData.get("entregaId") || "");
  const entrega = await prisma.entrega.findUnique({
    where: { id: entregaId },
    include: { entity: true, _count: { select: { documents: true, payments: true } } },
  });
  if (!entrega) throw new UserError("El viaje ya no existe.");

  const { documents, payments } = entrega._count;
  if (documents > 0 || payments > 0) {
    const partes = [
      documents > 0 ? `${documents} comprobante(s)` : null,
      payments > 0 ? `${payments} pago(s)` : null,
    ].filter(Boolean);
    throw new UserError(
      `No se puede borrar ${entrega.nombre}: tiene ${partes.join(" y ")}. Sacalos primero o dejalo como está.`
    );
  }

  await prisma.entrega.delete({ where: { id: entregaId } });

  await logAudit(prisma, {
    userId: user.id,
    action: "DELETE",
    entityType: "Viaje",
    entityId: entregaId,
    summary: `${entrega.nombre} — ${entrega.entity.name}`,
  });

  revalidatePath(`/cuentas-corrientes/${entrega.entity.slug}`);
}

/**
 * A nombre de quién sale el papel. No es un cliente: no tiene cuenta ni saldo, y lo único que
 * aporta es el nombre y el CUIT con el que se emite el comprobante y con el que entra al libro
 * de IVA.
 */
export async function crearDestinatario(formData: FormData) {
  const user = await requireRole(["ADMIN", "SECRETARIA"]);

  const entityId = String(formData.get("entityId") || "");
  const entity = await getEntidad(entityId);

  const nombre = String(formData.get("nombre") || "").trim();
  if (!nombre) throw new UserError("El nombre es obligatorio.");
  const taxId = String(formData.get("taxId") || "").trim() || null;

  const yaEsta = await prisma.destinatario.findFirst({ where: { entityId, nombre } });
  if (yaEsta) throw new UserError(`${nombre} ya está cargado para ${entity.name}.`);

  const destinatario = await prisma.destinatario.create({ data: { entityId, nombre, taxId } });

  await logAudit(prisma, {
    userId: user.id,
    action: "CREATE",
    entityType: "Destinatario",
    entityId: destinatario.id,
    summary: `${nombre}${taxId ? ` · ${taxId}` : ""} — por cuenta de ${entity.name}`,
  });

  revalidatePath(`/cuentas-corrientes/${entity.slug}`);
}

export async function actualizarDestinatario(formData: FormData) {
  const user = await requireRole(["ADMIN", "SECRETARIA"]);

  const destinatarioId = String(formData.get("destinatarioId") || "");
  const destinatario = await prisma.destinatario.findUnique({
    where: { id: destinatarioId },
    include: { entity: true },
  });
  if (!destinatario) throw new UserError("El destinatario ya no existe.");

  const nombre = String(formData.get("nombre") || "").trim();
  if (!nombre) throw new UserError("El nombre es obligatorio.");

  await prisma.destinatario.update({
    where: { id: destinatarioId },
    data: { nombre, taxId: String(formData.get("taxId") || "").trim() || null },
  });

  await logAudit(prisma, {
    userId: user.id,
    action: "UPDATE",
    entityType: "Destinatario",
    entityId: destinatarioId,
    summary: `${nombre} — por cuenta de ${destinatario.entity.name}`,
  });

  revalidatePath(`/cuentas-corrientes/${destinatario.entity.slug}`);
}

/**
 * Se niega si ya figura en algún comprobante: la clave está en SET NULL, así que borrarlo dejaría
 * facturas viejas sin a nombre de quién salieron, y eso es un agujero en el libro de IVA.
 */
export async function borrarDestinatario(formData: FormData) {
  const user = await requireRole(["ADMIN", "SECRETARIA"]);

  const destinatarioId = String(formData.get("destinatarioId") || "");
  const destinatario = await prisma.destinatario.findUnique({
    where: { id: destinatarioId },
    include: { entity: true, _count: { select: { documents: true } } },
  });
  if (!destinatario) throw new UserError("El destinatario ya no existe.");

  if (destinatario._count.documents > 0) {
    throw new UserError(
      `No se puede borrar a ${destinatario.nombre}: figura en ${destinatario._count.documents} comprobante(s).`
    );
  }

  await prisma.destinatario.delete({ where: { id: destinatarioId } });

  await logAudit(prisma, {
    userId: user.id,
    action: "DELETE",
    entityType: "Destinatario",
    entityId: destinatarioId,
    summary: `${destinatario.nombre} — por cuenta de ${destinatario.entity.name}`,
  });

  revalidatePath(`/cuentas-corrientes/${destinatario.entity.slug}`);
}
