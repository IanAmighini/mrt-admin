"use server";

import { Prisma, type FormaDeSueldo } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth-helpers";
import { UserError } from "@/lib/user-error";
import { logAudit } from "@/lib/audit";
import { generateUniqueSlug } from "@/lib/slug";
import { slugDeEntidad } from "@/lib/slug-lookup";
import { formatMoney, parseNumeroEscrito, ZERO } from "@/lib/money";
import { formatFecha, parseFecha } from "@/lib/period";
import { getCajasDeSueldos, getEmpleados, getUltimosMonotributos, nombreDePlanilla } from "@/lib/sueldos";
import { cerrarPlanillaCore, reabrirPlanillaCore } from "@/lib/sueldos-cierre";

const QUIENES = ["ADMIN", "SECRETARIA"] as const;

function leerForma(raw: FormDataEntryValue | null): FormaDeSueldo {
  const forma = String(raw || "");
  if (forma !== "SEMANAL" && forma !== "MENSUAL") throw new UserError("Elegí si cobra por semana o por mes.");
  return forma;
}

function leerFecha(raw: FormDataEntryValue | null, campo: string): Date {
  const valor = String(raw || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(valor)) throw new UserError(`Falta la fecha ${campo}.`);
  return parseFecha(valor);
}

function leerMonto(raw: FormDataEntryValue | null, campo: string): Prisma.Decimal {
  const monto = parseNumeroEscrito(String(raw || ""), campo);
  if (!monto.greaterThan(0)) throw new UserError(`El ${campo} tiene que ser mayor a cero.`);
  return monto;
}

/** Un campo de la grilla: vacío es "lo que sugiere la app" (null); escrito, se lee y no puede ser negativo. */
function leerOpcional(raw: FormDataEntryValue | null, campo: string): Prisma.Decimal | null {
  const texto = String(raw ?? "").trim();
  if (!texto) return null;
  const valor = parseNumeroEscrito(texto, campo);
  if (valor.isNegative()) throw new UserError(`${campo[0].toUpperCase()}${campo.slice(1)} no puede ser negativo.`);
  return valor;
}

function revalidarSueldos(planillaId?: string) {
  revalidatePath("/sueldos");
  if (planillaId) revalidatePath(`/sueldos/${planillaId}`);
}

// ─── Empleados ────────────────────────────────────────────────────────────────────────────────────

/**
 * Un empleado nuevo, o un proveedor que ya tenía ficha (Adriana) pasado a empleado. Es una ficha de
 * proveedor con rubro Sueldos: así le sirve todo lo que ya existe —su cuenta corriente, el cobro de
 * un cliente directo a él, los pagos desde la caja— sin aparecer en Proveedores.
 */
export async function crearEmpleado(formData: FormData) {
  const user = await requireRole([...QUIENES]);
  const existenteId = String(formData.get("existenteId") || "") || null;
  const name = String(formData.get("name") || "").replace(/\s+/g, " ").trim();
  const forma = leerForma(formData.get("forma"));
  const monto = leerMonto(formData.get("monto"), forma === "SEMANAL" ? "jornal" : "sueldo del mes");
  const desde = leerFecha(formData.get("desde"), "desde la que cobra eso");
  if (!existenteId && !name) throw new UserError("Poné el nombre.");

  const entity = await prisma.$transaction(async (tx) => {
    let entity;
    if (existenteId) {
      const previo = await tx.entity.findUnique({ where: { id: existenteId } });
      if (!previo || previo.type !== "PROVEEDOR") throw new UserError("Esa ficha no es de un proveedor.");
      if (previo.formaDeSueldo) throw new UserError(`${previo.name} ya es empleado.`);
      entity = await tx.entity.update({
        where: { id: existenteId },
        data: { formaDeSueldo: forma, empleadoBaja: null },
      });
    } else {
      const slug = await generateUniqueSlug(
        name,
        (candidate) => tx.entity.findFirst({ where: slugDeEntidad(candidate) }).then(Boolean),
        "empleado"
      );
      entity = await tx.entity.create({
        data: { name, slug, type: "PROVEEDOR", expenseCategory: "SUELDOS", formaDeSueldo: forma },
      });
      await tx.account.createMany({
        data: [
          { entityId: entity.id, circuit: "BLANCO" },
          { entityId: entity.id, circuit: "NEGRO" },
        ],
      });
    }
    await tx.tarifaDeEmpleado.create({ data: { entityId: entity.id, desde, monto, createdById: user.id } });

    // Si hay una planilla abierta de su forma, entra en ésa: si no, la semana en curso lo dejaba afuera.
    const abiertas = await tx.planillaDeSueldos.findMany({ where: { forma, estado: "BORRADOR" }, select: { id: true } });
    for (const p of abiertas) {
      await tx.renglonDeSueldo.create({ data: { planillaId: p.id, entityId: entity.id } });
    }

    await logAudit(tx, {
      userId: user.id,
      action: existenteId ? "UPDATE" : "CREATE",
      entityType: "Empleado",
      entityId: entity.id,
      summary: `${entity.name} — ${forma === "SEMANAL" ? `jornal de ${formatMoney(monto)}` : `sueldo de ${formatMoney(monto)} por mes`} desde el ${formatFecha(desde)}`,
    });
    return entity;
  });

  revalidarSueldos();
  revalidatePath("/proveedores");
  revalidatePath(`/cuentas-corrientes/${entity.slug}`);
}

/** Un aumento: una tarifa nueva desde una fecha. Las semanas anteriores siguen con la que tenían. */
export async function cambiarTarifa(formData: FormData) {
  const user = await requireRole([...QUIENES]);
  const entityId = String(formData.get("empleadoId") || "");
  const empleado = await prisma.entity.findUnique({ where: { id: entityId } });
  if (!empleado?.formaDeSueldo) throw new UserError("Ese empleado ya no existe.");
  const monto = leerMonto(formData.get("monto"), empleado.formaDeSueldo === "SEMANAL" ? "jornal" : "sueldo del mes");
  const desde = leerFecha(formData.get("desde"), "desde la que cobra eso");

  await prisma.$transaction(async (tx) => {
    const cerrada = await tx.renglonDeSueldo.findFirst({
      where: { entityId, planilla: { estado: "CERRADA", hasta: { gte: desde } } },
      include: { planilla: true },
    });
    if (cerrada) {
      throw new UserError(
        `La ${nombreDePlanilla(cerrada.planilla).toLowerCase()} ya está cerrada con el jornal anterior. Poné una fecha posterior, o reabrila primero.`
      );
    }
    // El mismo día pisa la que había: corregir un aumento mal tipeado no deja dos tarifas.
    await tx.tarifaDeEmpleado.deleteMany({ where: { entityId, desde } });
    await tx.tarifaDeEmpleado.create({ data: { entityId, desde, monto, createdById: user.id } });
    await logAudit(tx, {
      userId: user.id,
      action: "UPDATE",
      entityType: "Empleado",
      entityId,
      summary: `${empleado.name} — ${empleado.formaDeSueldo === "SEMANAL" ? "jornal" : "sueldo del mes"} de ${formatMoney(monto)} desde el ${formatFecha(desde)}`,
    });
  });
  revalidarSueldos();
}

export async function darDeBajaEmpleado(formData: FormData) {
  const user = await requireRole([...QUIENES]);
  const entityId = String(formData.get("empleadoId") || "");
  const baja = formData.get("reactivar") === "1" ? null : new Date();
  const empleado = await prisma.entity.update({ where: { id: entityId }, data: { empleadoBaja: baja } });
  await logAudit(prisma, {
    userId: user.id,
    action: "UPDATE",
    entityType: "Empleado",
    entityId,
    summary: `${empleado.name} — ${baja ? "dado de baja" : "vuelve a estar activo"}`,
  });
  revalidarSueldos();
}

// ─── Planillas ────────────────────────────────────────────────────────────────────────────────────

export async function crearPlanilla(formData: FormData) {
  const user = await requireRole([...QUIENES]);
  const forma = leerForma(formData.get("forma"));
  const desde = leerFecha(formData.get("desde"), "de inicio");
  const hasta = leerFecha(formData.get("hasta"), "de fin");
  const fechaDePago = leerFecha(formData.get("fechaDePago"), "de pago");
  if (hasta < desde) throw new UserError("La fecha de fin es anterior a la de inicio.");

  const pisada = await prisma.planillaDeSueldos.findFirst({
    where: { forma, desde: { lte: hasta }, hasta: { gte: desde } },
  });
  if (pisada) throw new UserError(`Ya hay una planilla para esas fechas: la ${nombreDePlanilla(pisada).toLowerCase()}.`);

  const empleados = (await getEmpleados()).filter((e) => e.forma === forma);
  if (empleados.length === 0) {
    throw new UserError(forma === "SEMANAL" ? "No hay empleados que cobren por semana." : "No hay empleados que cobren por mes.");
  }
  const cajas = await getCajasDeSueldos();
  const monotributos = forma === "MENSUAL" ? await getUltimosMonotributos(empleados.map((e) => e.id)) : new Map();

  const planilla = await prisma.$transaction(async (tx) => {
    const planilla = await tx.planillaDeSueldos.create({
      data: {
        forma,
        desde,
        hasta,
        fechaDePago,
        cajaId: cajas[0]?.id ?? null,
        createdById: user.id,
        // El monotributo del mes arranca con el del último mes cerrado: cambia poco.
        renglones: { create: empleados.map((e) => ({ entityId: e.id, monotributo: monotributos.get(e.id) ?? null })) },
      },
    });
    await logAudit(tx, {
      userId: user.id,
      action: "CREATE",
      entityType: "Planilla de sueldos",
      entityId: planilla.id,
      summary: `${nombreDePlanilla(planilla)} — ${empleados.length} empleados`,
    });
    return planilla;
  });
  revalidarSueldos();
  redirect(`/sueldos/${planilla.id}`);
}

/** Lo que trae la grilla, renglón por renglón. Sólo se guarda en una planilla abierta. */
async function guardarCampos(formData: FormData) {
  const planillaId = String(formData.get("planillaId") || "");
  const planilla = await prisma.planillaDeSueldos.findUnique({
    where: { id: planillaId },
    include: { renglones: { include: { entity: { select: { name: true } } } } },
  });
  if (!planilla) throw new UserError("Esa planilla ya no existe.");
  if (planilla.estado !== "BORRADOR") throw new UserError("La planilla ya está cerrada: para cambiarla, reabrila.");

  const fechaDePago = leerFecha(formData.get("fechaDePago"), "de pago");
  const cajaId = String(formData.get("cajaId") || "") || null;
  if (cajaId && !(await getCajasDeSueldos()).some((c) => c.id === cajaId)) throw new UserError("Elegí la caja de la que sale.");
  const notas = String(formData.get("notas") || "").trim() || null;

  const cambios = planilla.renglones.map((r) => {
    const de = (campo: string) => formData.get(`${campo}_${r.id}`);
    const quien = r.entity.name;
    const horas = leerOpcional(de("horas"), `las horas de ${quien}`) ?? ZERO;
    const horasFeriado = leerOpcional(de("feriado"), `las horas de feriado de ${quien}`) ?? ZERO;
    if (horasFeriado.greaterThan(horas)) {
      throw new UserError(`${quien}: las horas de feriado van dentro del total, así que no pueden ser más que las horas.`);
    }
    return {
      id: r.id,
      horas,
      horasFeriado,
      presentismo: de("presentismo") === "on",
      puntualidad: de("puntualidad") === "on",
      monotributo: leerOpcional(de("monotributo"), `el monotributo de ${quien}`),
      descuentoACuenta: leerOpcional(de("acuenta"), `lo que se le descuenta a ${quien}`),
      pagado: leerOpcional(de("pagado"), `lo que se le da a ${quien}`),
      comentario: String(de("comentario") ?? "").trim() || null,
    };
  });

  await prisma.$transaction([
    prisma.planillaDeSueldos.update({ where: { id: planillaId }, data: { fechaDePago, cajaId, notas } }),
    ...cambios.map(({ id, ...data }) => prisma.renglonDeSueldo.update({ where: { id }, data })),
  ]);
  return planillaId;
}

export async function guardarPlanilla(formData: FormData) {
  await requireRole([...QUIENES]);
  const planillaId = await guardarCampos(formData);
  if (formData.get("accion") === "cerrar") {
    const user = await requireRole([...QUIENES]);
    const { cajaSlug } = await cerrarPlanillaCore(planillaId, user.id);
    revalidatePath(`/cuentas-corrientes/${cajaSlug}`);
    revalidatePath("/caja-chica");
    revalidatePath("/tesoreria");
    revalidatePath("/compras");
  }
  revalidarSueldos(planillaId);
}

/** Vuelve la planilla a borrador: borra los gastos y los pagos que cargó. Los números quedan. */
export async function reabrirPlanilla(formData: FormData) {
  const user = await requireRole([...QUIENES]);
  const planillaId = String(formData.get("planillaId") || "");
  await reabrirPlanillaCore(planillaId, user.id);
  revalidarSueldos(planillaId);
  revalidatePath("/caja-chica");
  revalidatePath("/tesoreria");
}

export async function borrarPlanilla(formData: FormData) {
  const user = await requireRole([...QUIENES]);
  const planillaId = String(formData.get("planillaId") || "");
  const planilla = await prisma.planillaDeSueldos.findUnique({ where: { id: planillaId } });
  if (!planilla) throw new UserError("Esa planilla ya no existe.");
  if (planilla.estado !== "BORRADOR") throw new UserError("Una planilla cerrada no se borra: reabrila primero.");
  await prisma.$transaction(async (tx) => {
    await tx.planillaDeSueldos.delete({ where: { id: planillaId } });
    await logAudit(tx, {
      userId: user.id,
      action: "DELETE",
      entityType: "Planilla de sueldos",
      entityId: planillaId,
      summary: `${nombreDePlanilla(planilla)} (borrador)`,
    });
  });
  revalidarSueldos();
  redirect("/sueldos");
}

