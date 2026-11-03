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

type Referencia = { campo: string; hacia: string; opcional: boolean; columnas: string[] };

const referenciasDe = (m: Modelo): Referencia[] =>
  m.fields
    .filter((f) => f.kind === "object" && (f.relationFromFields?.length ?? 0) > 0)
    .map((f) => ({ campo: f.name, hacia: f.type, opcional: !f.isRequired, columnas: [...(f.relationFromFields ?? [])] }));

/**
 * Las tablas en el orden en que se pueden cargar: cada una después de las que referencia. Sale del
 * esquema, así que una tabla nueva entra sola al respaldo sin tocar esto.
 *
 * Algunas referencias no cuentan para el orden y se cargan vacías, para completarlas al final
 * (`diferidas`): las de una tabla a sí misma (el pase entre cajas apunta a su otra pata) y las que
 * cierran un círculo entre dos tablas (el comprobante que generó un pago y el pago que cobra una
 * venta). Del círculo se difiere siempre una referencia opcional, que es la que puede quedar vacía
 * un rato.
 */
export function planDeCarga(): { orden: Modelo[]; diferidas: Map<string, string[]> } {
  const modelos = Prisma.dmmf.datamodel.models;
  const diferidas = new Map<string, string[]>(modelos.map((m) => [m.name, []]));
  const pendientes = new Map(modelos.map((m) => [m.name, referenciasDe(m)]));
  for (const m of modelos) {
    const propias = pendientes.get(m.name)!.filter((r) => r.hacia === m.name);
    diferidas.get(m.name)!.push(...propias.flatMap((r) => r.columnas));
    pendientes.set(m.name, pendientes.get(m.name)!.filter((r) => r.hacia !== m.name));
  }
  const orden: Modelo[] = [];
  const hechos = new Set<string>();
  while (orden.length < modelos.length) {
    const listos = modelos.filter((m) => !hechos.has(m.name) && pendientes.get(m.name)!.every((r) => hechos.has(r.hacia)));
    if (listos.length > 0) {
      for (const m of listos) {
        orden.push(m);
        hechos.add(m.name);
      }
      continue;
    }
    // Trabado: hay un círculo. Se difiere una referencia opcional que sea parte de él —la tabla a
    // la que apunta vuelve, por otro camino, a la que apunta—, la primera por nombre para que el
    // orden salga siempre igual. Las que sólo esperan al círculo se cargan normal después.
    const vuelve = (desde: string, hasta: string) => {
      const vistos = new Set<string>();
      const pila = [desde];
      while (pila.length > 0) {
        const x = pila.pop()!;
        if (x === hasta) return true;
        if (vistos.has(x)) continue;
        vistos.add(x);
        pila.push(...pendientes.get(x)!.filter((r) => !hechos.has(r.hacia)).map((r) => r.hacia));
      }
      return false;
    };
    const candidata = modelos
      .filter((m) => !hechos.has(m.name))
      .flatMap((m) =>
        pendientes.get(m.name)!.filter((r) => r.opcional && !hechos.has(r.hacia) && vuelve(r.hacia, m.name)).map((r) => ({ m, r }))
      )
      .sort((x, y) => `${x.m.name}.${x.r.campo}`.localeCompare(`${y.m.name}.${y.r.campo}`))[0];
    if (!candidata) throw new Error("Las tablas se referencian en círculo sin ninguna referencia opcional: no hay orden para cargarlas.");
    diferidas.get(candidata.m.name)!.push(...candidata.r.columnas);
    pendientes.set(candidata.m.name, pendientes.get(candidata.m.name)!.filter((r) => r !== candidata.r));
  }
  return { orden, diferidas };
}

async function ultimaMigracion(db: PrismaClient): Promise<string | null> {
  const filas = await db.$queryRawUnsafe<{ migration_name: string }[]>(
    `SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name DESC LIMIT 1`
  );
  return filas[0]?.migration_name ?? null;
}

export async function armarRespaldo(db: PrismaClient): Promise<Respaldo> {
  const tablas: Record<string, unknown[]> = {};
  for (const m of planDeCarga().orden) {
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
function revivir(m: Modelo, fila: Record<string, unknown>, diferidas: string[]) {
  const out: Record<string, unknown> = {};
  for (const f of m.fields) {
    if (f.kind === "object" || !(f.name in fila)) continue;
    let v = fila[f.name];
    if (diferidas.includes(f.name)) v = null;
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
  const { orden, diferidas } = planDeCarga();
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
      // Antes de borrar se cortan las referencias diferidas, que si no frenan el borrado: apuntan a
      // tablas que se borran antes, o a la misma.
      for (const m of orden) {
        const cols = diferidas.get(m.name)!;
        if (cols.length > 0) {
          await tx.$executeRawUnsafe(`UPDATE "${m.dbName ?? m.name}" SET ${cols.map((c) => `"${c}" = NULL`).join(", ")}`);
        }
      }
      for (const m of [...orden].reverse()) {
        await t[delegado(m.name)].deleteMany();
      }
      for (const m of orden) {
        const filas = (respaldo.tablas[m.name] ?? []) as Record<string, unknown>[];
        const auto = diferidas.get(m.name)!;
        for (let i = 0; i < filas.length; i += 500) {
          await t[delegado(m.name)].createMany({ data: filas.slice(i, i + 500).map((f) => revivir(m, f, auto)) });
        }
      }
      // Las referencias diferidas, ahora que están todas las filas: también las de la tabla a la
      // que apuntan, que en un círculo se carga después.
      for (const m of orden) {
        const auto = diferidas.get(m.name)!;
        if (auto.length === 0) continue;
        const idField = m.fields.find((f) => f.isId)!.name;
        for (const fila of (respaldo.tablas[m.name] ?? []) as Record<string, unknown>[]) {
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
