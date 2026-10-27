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
import { fechaISO, getCajasDeSueldos, getEmpleados, getReglasFichero, getUltimosMonotributos, mesDe, nombreDePlanilla, SETTING_REGLAS_FICHERO } from "@/lib/sueldos";
import { BONOS_DESDE, esHora, esMes, fechasDe, leerReglas, nombreDelMes, rangoDelMes, resumenDeSemana, type DiaFichero, type ReglasFichero } from "@/lib/fichero-calculo";
import { setSetting } from "@/lib/settings";
import { leerArchivoDelFichero } from "@/lib/fichero-xls";
import { importarMarcasCore, importarMesCore } from "@/lib/sueldos-fichero";
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

/** Los días de un empleado tal como los manda la grilla, validados: fechas y horas con forma de hora. */
function leerDias(raw: FormDataEntryValue | null, quien: string): DiaFichero[] | null {
  const texto = String(raw ?? "").trim();
  if (!texto) return null;
  let dias: unknown;
  try {
    dias = JSON.parse(texto);
  } catch {
    throw new UserError(`Los días de ${quien} llegaron mal. Recargá la página y volvé a intentar.`);
  }
  if (!Array.isArray(dias)) throw new UserError(`Los días de ${quien} llegaron mal.`);
  const hora = (h: unknown, cual: string, fecha: string) => {
    if (h === undefined) return undefined;
    if (h === null || h === "") return null;
    if (typeof h !== "string" || !esHora(h)) throw new UserError(`${quien}, ${fecha.split("-").reverse().join("/")}: "${String(h)}" no es una hora de ${cual} (tiene que ser como 07:30).`);
    return h.trim();
  };
  return dias.map((d) => {
    const fecha = String(d?.fecha ?? "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) throw new UserError(`Los días de ${quien} llegaron mal.`);
    const entrada = hora(d.entrada, "entrada", fecha);
    const salida = hora(d.salida, "salida", fecha);
    return {
      fecha,
      marcas: Array.isArray(d.marcas) ? d.marcas.map(String).filter(esHora) : [],
      ...(entrada !== undefined ? { entrada } : {}),
      ...(salida !== undefined ? { salida } : {}),
      ...(d.arrastre ? { arrastre: true } : {}),
    };
  });
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
  const desde = fechaISO(planilla.desde);
  const hasta = fechaISO(planilla.hasta);
  const deLaSemana = fechasDe(desde, hasta);
  // Los feriados de la semana: sus horas van al valor hora + 0,5 y no cuentan para el presentismo.
  const feriados = formData
    .getAll("feriado_fecha")
    .map(String)
    .filter((f) => deLaSemana.includes(f));
  // Los del mes de los bonos, que no cuentan para el presentismo.
  const delMes = planilla.bonosDe ? rangoDelMes(planilla.bonosDe) : null;
  const feriadosDelMes = delMes
    ? formData
        .getAll("feriado_mes")
        .map(String)
        .filter((f) => /^\d{4}-\d{2}-\d{2}$/.test(f) && f >= delMes.desde && f <= delMes.hasta)
    : [];
  const reglas = await getReglasFichero();

  const cambios = planilla.renglones.map((r) => {
    const de = (campo: string) => formData.get(`${campo}_${r.id}`);
    const quien = r.entity.name;
    // Con los días del fichero, las horas salen de ahí —con las correcciones a mano— y se vuelven a
    // calcular acá: lo que mande el navegador no se toma tal cual.
    const dias = leerDias(de("dias"), quien);
    const resumen = dias ? resumenDeSemana(dias, reglas, { desde, hasta, feriados }) : null;
    const horas = resumen ? new Prisma.Decimal(resumen.horas) : (leerOpcional(de("horas"), `las horas de ${quien}`) ?? ZERO);
    const horasFeriado = resumen
      ? new Prisma.Decimal(resumen.horasFeriado)
      : (leerOpcional(de("feriado"), `las horas de feriado de ${quien}`) ?? ZERO);
    if (horasFeriado.greaterThan(horas)) {
      throw new UserError(`${quien}: las horas de feriado van dentro del total, así que no pueden ser más que las horas.`);
    }
    return {
      id: r.id,
      ...(dias ? { dias: dias as unknown as Prisma.InputJsonValue } : {}),
      horas,
      horasFeriado,
      // Los bonos son del mes: sólo los lleva la semana que paga los de algún mes.
      presentismo: Boolean(planilla.bonosDe) && de("presentismo") === "on",
      puntualidad: Boolean(planilla.bonosDe) && de("puntualidad") === "on",
      monotributo: leerOpcional(de("monotributo"), `el monotributo de ${quien}`),
      descuentoACuenta: leerOpcional(de("acuenta"), `lo que se le descuenta a ${quien}`),
      pagado: leerOpcional(de("pagado"), `lo que se le da a ${quien}`),
      comentario: String(de("comentario") ?? "").trim() || null,
    };
  });

  await prisma.$transaction([
    prisma.planillaDeSueldos.update({ where: { id: planillaId }, data: { fechaDePago, cajaId, notas, feriados, feriadosDelMes } }),
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


// ─── Fichero ──────────────────────────────────────────────────────────────────────────────────────

/** Las reglas con que se calculan las horas del fichero. Sólo el admin: cambian lo que cobra cada uno. */
export async function guardarReglasFichero(formData: FormData) {
  const user = await requireRole(["ADMIN"]);
  const hora = (campo: string, nombre: string) => {
    const v = String(formData.get(campo) || "").trim();
    if (!esHora(v)) throw new UserError(`${nombre}: tiene que ser una hora, como 08:00.`);
    return v;
  };
  const numero = (campo: string, nombre: string) => {
    const v = parseNumeroEscrito(String(formData.get(campo) || ""), nombre);
    if (v.isNegative()) throw new UserError(`${nombre} no puede ser negativo.`);
    return v.toNumber();
  };
  const reglas: ReglasFichero = {
    entradaPuntual: hora("entradaPuntual", "La hora de entrada"),
    corteViernes: hora("corteViernes", "El corte del viernes"),
    almuerzoMinutos: numero("almuerzoMinutos", "El almuerzo"),
    diaConAlmuerzoHoras: numero("diaConAlmuerzoHoras", "Desde cuántas horas se descuenta el almuerzo"),
    presentismoHoras: numero("presentismoHoras", "Las horas para el presentismo"),
    redondeoHoras: numero("redondeoHoras", "El redondeo"),
  };
  const antes = leerReglas(await getSettingDeReglas());
  await setSetting(SETTING_REGLAS_FICHERO, JSON.stringify(reglas));
  await logAudit(prisma, {
    userId: user.id,
    action: "UPDATE",
    entityType: "Reglas del fichero",
    entityId: SETTING_REGLAS_FICHERO,
    summary: `Reglas del fichero: entrada hasta ${reglas.entradaPuntual}, viernes hasta ${reglas.corteViernes}, almuerzo ${reglas.almuerzoMinutos} min en días de ${reglas.diaConAlmuerzoHoras} h o más, presentismo con ${reglas.presentismoHoras} h, redondeo ${reglas.redondeoHoras} h`,
    cambios: (Object.keys(reglas) as (keyof ReglasFichero)[])
      .filter((k) => String(antes[k]) !== String(reglas[k]))
      .map((k) => ({ campo: k, antes: String(antes[k]), despues: String(reglas[k]) })),
  });
  revalidarSueldos();
}

async function getSettingDeReglas() {
  const fila = await prisma.setting.findUnique({ where: { key: SETTING_REGLAS_FICHERO } });
  return fila?.value ?? null;
}

/** El número de un empleado en el reloj, para encontrarlo al importar. */
export async function guardarIdFichero(formData: FormData) {
  const user = await requireRole([...QUIENES]);
  const entityId = String(formData.get("empleadoId") || "");
  const idFichero = String(formData.get("idFichero") || "").trim() || null;
  if (idFichero && !/^\d+$/.test(idFichero)) throw new UserError("El número del fichero son sólo dígitos, como 1004.");
  const empleado = await prisma.entity.update({ where: { id: entityId }, data: { idFichero } });
  await logAudit(prisma, {
    userId: user.id,
    action: "UPDATE",
    entityType: "Empleado",
    entityId,
    summary: `${empleado.name} — número en el fichero: ${idFichero ?? "(ninguno)"}`,
  });
  revalidarSueldos();
}

/**
 * Importa las marcas del reloj a la planilla de la semana: el Excel que baja Adriana del fichero.
 * Vuelve a la planilla con el resultado en la dirección, para mostrar qué se importó y qué no.
 */
export async function importarFichero(formData: FormData) {
  const user = await requireRole([...QUIENES]);
  const planillaId = String(formData.get("planillaId") || "");
  const archivo = formData.get("archivo");
  if (!(archivo instanceof File) || archivo.size === 0) throw new UserError("Elegí el archivo que exporta el reloj.");
  const exportacion = leerArchivoDelFichero(await archivo.arrayBuffer());
  const r = await importarMarcasCore(planillaId, exportacion, user.id);
  revalidarSueldos(planillaId);
  const aviso = new URLSearchParams({ importados: String(r.importados), pendientes: String(r.pendientes) });
  if (r.sinMarcas.length) aviso.set("sinMarcas", r.sinMarcas.join(", "));
  if (r.ambiguos.length) aviso.set("ambiguos", r.ambiguos.join(", "));
  if (r.diasFuera.length) aviso.set("diasFuera", r.diasFuera.map((f) => f.split("-").reverse().slice(0, 2).join("/")).join(", "));
  redirect(`/sueldos/${planillaId}?${aviso.toString()}`);
}

// ─── Bonos del mes ────────────────────────────────────────────────────────────────────────────────

/**
 * Elige de qué mes son los bonos que paga esta semana, o los saca ("" en `mes`). Cambiar de mes
 * borra lo que se había marcado: eran los bonos de otro mes. Un mes se paga una sola vez.
 */
export async function elegirBonosDe(formData: FormData) {
  const user = await requireRole([...QUIENES]);
  const planillaId = String(formData.get("planillaId") || "");
  const mes = String(formData.get("mes") || "").trim() || null;
  const planilla = await prisma.planillaDeSueldos.findUnique({ where: { id: planillaId } });
  if (!planilla) throw new UserError("Esa planilla ya no existe.");
  if (planilla.forma !== "SEMANAL") throw new UserError("Los bonos se pagan en las planillas por semana.");
  if (planilla.estado !== "BORRADOR") throw new UserError("La planilla ya está cerrada: para cambiarla, reabrila.");
  if (mes) {
    if (!esMes(mes)) throw new UserError("Elegí el mes de los bonos.");
    if (mes < BONOS_DESDE && mes !== planilla.bonosDe) {
      throw new UserError(`Los bonos se eligen desde los de ${nombreDelMes(BONOS_DESDE)} de ${BONOS_DESDE.slice(0, 4)}.`);
    }
    if (mes > mesDe(planilla.hasta)) throw new UserError(`La semana termina el ${formatFecha(planilla.hasta)}: los bonos de ${nombreDelMes(mes)} todavía no se ganaron.`);
    const otra = await prisma.planillaDeSueldos.findFirst({ where: { bonosDe: mes, id: { not: planillaId } } });
    if (otra) {
      throw new UserError(`Los bonos de ${nombreDelMes(mes)} ya van en la ${nombreDePlanilla(otra).toLowerCase()}.`);
    }
  }
  if (mes === planilla.bonosDe) return;

  await prisma.$transaction(async (tx) => {
    await tx.planillaDeSueldos.update({ where: { id: planillaId }, data: { bonosDe: mes, feriadosDelMes: [] } });
    await tx.renglonDeSueldo.updateMany({
      where: { planillaId },
      data: { presentismo: false, puntualidad: false, diasDelMes: Prisma.DbNull },
    });
    await logAudit(tx, {
      userId: user.id,
      action: "UPDATE",
      entityType: "Planilla de sueldos",
      entityId: planillaId,
      summary: mes
        ? `${nombreDePlanilla(planilla)}: paga los bonos de ${nombreDelMes(mes)}`
        : `${nombreDePlanilla(planilla)}: ya no paga bonos${planilla.bonosDe ? ` (eran los de ${nombreDelMes(planilla.bonosDe)})` : ""}`,
      cambios: [{ campo: "Bonos de", antes: planilla.bonosDe ? nombreDelMes(planilla.bonosDe) : null, despues: mes ? nombreDelMes(mes) : null }],
    });
  });
  revalidarSueldos(planillaId);
}

/** El fichero del mes de los bonos: sugiere presentismo y puntualidad de cada uno. */
export async function importarFicheroDelMes(formData: FormData) {
  const user = await requireRole([...QUIENES]);
  const planillaId = String(formData.get("planillaId") || "");
  const archivo = formData.get("archivo");
  if (!(archivo instanceof File) || archivo.size === 0) throw new UserError("Elegí el archivo que exporta el reloj.");
  const exportacion = leerArchivoDelFichero(await archivo.arrayBuffer());
  const r = await importarMesCore(planillaId, exportacion, user.id);
  revalidarSueldos(planillaId);
  const aviso = new URLSearchParams({ bonos: String(r.importados), pendientes: String(r.pendientes) });
  if (r.sinMarcas.length) aviso.set("sinMarcas", r.sinMarcas.join(", "));
  if (r.ambiguos.length) aviso.set("ambiguos", r.ambiguos.join(", "));
  redirect(`/sueldos/${planillaId}?${aviso.toString()}`);
}
