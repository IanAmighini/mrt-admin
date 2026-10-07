import { gunzipSync, gzipSync } from "node:zlib";
import { Prisma, type PrismaClient } from "@prisma/client";

/**
 * El respaldo de la base entera en un solo archivo: un JSON comprimido con gzip, una lista de filas
 * por tabla. Es lo más liviano que se puede leer sin herramientas —se descomprime con doble click y
 * se abre con cualquier editor— y alcanza para volver a dejar la base exactamente como estaba.
 *
 * No importa `server-only` a propósito: lo usan la descarga (en la app) y el comando de restaurar
 * (`npm run restaurar-respaldo`), que corre fuera de Next.
 */

export const VERSION_DEL_RESPALDO = 1;

export type Respaldo = {
  version: number;
  generadoEl: string;
  /** La última migración aplicada cuando se hizo: restaurar en una base con otra estructura no
   * es seguro, y el comando lo frena. */
  migracion: string | null;
  tablas: Record<string, unknown[]>;
};

type Modelo = (typeof Prisma.dmmf.datamodel.models)[number];

/** El nombre con que el cliente de Prisma expone un modelo: `Document` → `document`. */
const delegado = (modelo: string) => modelo.charAt(0).toLowerCase() + modelo.slice(1);

/**
 * Las tablas en el orden en que se pueden cargar: cada una después de las que referencia. Sale del
 * esquema, así que una tabla nueva entra sola al respaldo sin tocar esto.
 *
 * Las referencias de una tabla a sí misma (el pase entre cajas apunta a su otra pata) no cuentan
 * para el orden: se cargan vacías y se completan al final.
 */
export function ordenDeTablas(): Modelo[] {
  const modelos = Prisma.dmmf.datamodel.models;
  const depende = new Map(
    modelos.map((m) => [
      m.name,
      new Set(
        m.fields
          .filter((f) => f.kind === "object" && (f.relationFromFields?.length ?? 0) > 0 && f.type !== m.name)
          .map((f) => f.type)
      ),
    ])
  );
  const orden: Modelo[] = [];
  const hechos = new Set<string>();
  while (orden.length < modelos.length) {
    const listos = modelos.filter((m) => !hechos.has(m.name) && [...depende.get(m.name)!].every((d) => hechos.has(d)));
    if (listos.length === 0) throw new Error("Las tablas se referencian en círculo: no hay orden para cargarlas.");
    for (const m of listos) {
      orden.push(m);
      hechos.add(m.name);
    }
  }
  return orden;
}

/** Los campos de un modelo que apuntan al mismo modelo (`Document.contraparteId`). */
function autoReferencias(m: Modelo): string[] {
  return m.fields
    .filter((f) => f.kind === "object" && f.type === m.name && (f.relationFromFields?.length ?? 0) > 0)
    .flatMap((f) => f.relationFromFields ?? []);
}

async function ultimaMigracion(db: PrismaClient): Promise<string | null> {
  const filas = await db.$queryRawUnsafe<{ migration_name: string }[]>(
    `SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name DESC LIMIT 1`
  );
  return filas[0]?.migration_name ?? null;
}

export async function armarRespaldo(db: PrismaClient): Promise<Respaldo> {
  const tablas: Record<string, unknown[]> = {};
  for (const m of ordenDeTablas()) {
    // Ordenadas por id para que dos respaldos de la misma base salgan iguales.
    const idField = m.fields.find((f) => f.isId)?.name;
    tablas[m.name] = await (db as unknown as Record<string, { findMany: (a: object) => Promise<unknown[]> }>)[
      delegado(m.name)
    ].findMany(idField ? { orderBy: { [idField]: "asc" } } : {});
  }
  return {
    version: VERSION_DEL_RESPALDO,
    generadoEl: new Date().toISOString(),
    migracion: await ultimaMigracion(db),
    tablas,
  };
}

/** El respaldo como archivo: JSON comprimido. Los decimales salen como texto, sin perder nada. */
export function comprimirRespaldo(respaldo: Respaldo): Buffer {
  return gzipSync(Buffer.from(JSON.stringify(respaldo)), { level: 9 });
}

export function leerRespaldo(archivo: Buffer): Respaldo {
  const texto = (archivo[0] === 0x1f && archivo[1] === 0x8b ? gunzipSync(archivo) : archivo).toString("utf8");
  const respaldo = JSON.parse(texto) as Respaldo;
  if (respaldo.version !== VERSION_DEL_RESPALDO || !respaldo.tablas) {
    throw new Error("El archivo no es un respaldo de esta app, o es de una versión que no se sabe leer.");
  }
  return respaldo;
}

/** Una fila del archivo, de vuelta con los tipos que espera la base. */
function revivir(m: Modelo, fila: Record<string, unknown>, sinAutoReferencias: string[]) {
  const out: Record<string, unknown> = {};
  for (const f of m.fields) {
    if (f.kind === "object" || !(f.name in fila)) continue;
    let v = fila[f.name];
    if (sinAutoReferencias.includes(f.name)) v = null;
    else if (v !== null && f.type === "DateTime") v = new Date(v as string);
    else if (v === null && f.type === "Json") v = Prisma.DbNull;
    out[f.name] = v;
  }
  return out;
}

/**
 * Deja la base igual que el respaldo: borra todo y vuelve a cargar cada tabla, en una sola
 * transacción. Si algo falla en el medio, la base queda como estaba antes de empezar.
 */
export async function restaurarRespaldo(db: PrismaClient, respaldo: Respaldo) {
  const orden = ordenDeTablas();
  await db.$transaction(
    async (tx) => {
      const t = tx as unknown as Record<
        string,
        {
          deleteMany: () => Promise<unknown>;
          createMany: (a: { data: object[] }) => Promise<unknown>;
          update: (a: object) => Promise<unknown>;
        }
      >;
      for (const m of [...orden].reverse()) {
        const auto = autoReferencias(m);
        // Antes de borrar se cortan las referencias a sí misma, que si no frenan el borrado.
        if (auto.length > 0) {
          await tx.$executeRawUnsafe(
            `UPDATE "${m.dbName ?? m.name}" SET ${auto.map((c) => `"${c}" = NULL`).join(", ")}`
          );
        }
        await t[delegado(m.name)].deleteMany();
      }
      for (const m of orden) {
        const filas = (respaldo.tablas[m.name] ?? []) as Record<string, unknown>[];
        const auto = autoReferencias(m);
        for (let i = 0; i < filas.length; i += 500) {
          await t[delegado(m.name)].createMany({ data: filas.slice(i, i + 500).map((f) => revivir(m, f, auto)) });
        }
        // Las referencias a sí misma, ahora que están todas las filas.
        const idField = m.fields.find((f) => f.isId)!.name;
        for (const fila of filas) {
          const cambios = Object.fromEntries(auto.filter((c) => fila[c] != null).map((c) => [c, fila[c]]));
          if (Object.keys(cambios).length > 0) {
            await t[delegado(m.name)].update({ where: { [idField]: fila[idField] }, data: cambios });
          }
        }
      }
    },
    { timeout: 10 * 60 * 1000, maxWait: 30 * 1000 }
  );
}

/** Cuántas filas tiene cada tabla del respaldo, para mostrarlo antes de restaurar. */
export function resumenDelRespaldo(respaldo: Respaldo) {
  return Object.entries(respaldo.tablas).map(([tabla, filas]) => ({ tabla, filas: filas.length }));
}
