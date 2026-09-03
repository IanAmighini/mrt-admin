import "server-only";
import type { EntityType, UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { CIRCUIT_SLUGS, SUPPLIER_CATEGORY_LABELS } from "@/lib/labels";
import { formatProductLabel } from "@/lib/product-label";

export type SearchResultKind =
  | "cliente"
  | "proveedor"
  | "tesoreria"
  | "insumo"
  | "producto"
  | "entrega"
  | "compra";

export type SearchResult = {
  kind: SearchResultKind;
  /** Clave de React; para documentos es el id del comprobante que quedó tras deduplicar. */
  id: string;
  label: string;
  sublabel: string;
  /** Ruta lista para navegar; siempre arranca con "/". */
  href: string;
};

/** Orden fijo entre grupos cuando ninguno gana por relevancia. */
const KIND_ORDER: SearchResultKind[] = [
  "cliente",
  "proveedor",
  "tesoreria",
  "insumo",
  "producto",
  "entrega",
  "compra",
];

const ENTITY_TYPE_LABELS: Record<EntityType, string> = {
  CLIENTE: "Cliente",
  PROVEEDOR: "Proveedor",
  AMBOS: "Cliente y proveedor",
  TESORERIA: "Tesorería",
};

const MIN_TERM_LENGTH = 2;
const TAKE_POR_TIPO = 5;

/** 3 = coincide exacto, 2 = empieza con, 1 = contiene. */
function matchScore(field: string | null | undefined, term: string): number {
  if (!field) return 0;
  const value = field.toLowerCase();
  if (value === term) return 3;
  if (value.startsWith(term)) return 2;
  return value.includes(term) ? 1 : 0;
}

function bestScore(fields: (string | null | undefined)[], term: string): number {
  return Math.max(0, ...fields.map((f) => matchScore(f, term)));
}

function soloDigitos(value: string): string {
  return value.replace(/\D/g, "");
}

/** El CUIT se carga con guiones ("20-12345678-9"), así que un `contains` crudo no lo encuentra. */
function pareceCuit(term: string): boolean {
  return term.length >= 3 && /^[\d.\-\s]+$/.test(term);
}

function kindDeEntidad(type: EntityType): SearchResultKind {
  if (type === "TESORERIA") return "tesoreria";
  if (type === "PROVEEDOR") return "proveedor";
  return "cliente";
}

function hrefDeEntidad(slug: string, type: EntityType): string {
  // Las tesorerías no tienen ficha resumen útil: se entra directo a una de sus dos cuentas.
  return type === "TESORERIA"
    ? `/cuentas-corrientes/${slug}/${CIRCUIT_SLUGS.BLANCO}`
    : `/cuentas-corrientes/${slug}`;
}

type Scored = { result: SearchResult; score: number };

/**
 * Busca en entidades, insumos, productos y comprobantes a la vez. Devuelve las filas ya armadas
 * (texto y ruta incluidos) para que el cliente no tenga que saber nada de rutas ni volver a
 * formatear decimales y fechas del otro lado del límite JSON.
 *
 * `role` solo se usa para ocultarle las tesorerías a Secretaria, mismo criterio que el menú. Ojo:
 * eso es ocultar, no bloquear — /cuentas-corrientes no tiene gate de rol, así que quien sepa el
 * slug ya entra igual.
 */
export async function searchAll(rawTerm: string, role: UserRole): Promise<SearchResult[]> {
  const term = rawTerm.trim().toLowerCase();
  if (term.length < MIN_TERM_LENGTH) return [];

  // La gente escribe los remitos con numeral, como los muestra la app ("#900").
  const numeroTerm = term.replace(/^#/, "");
  const contains = { contains: term, mode: "insensitive" } as const;
  const ocultarTesorerias = role === "SECRETARIA";

  const [entidades, insumos, productos, documentos, porCuit] = await Promise.all([
    prisma.entity.findMany({
      where: {
        OR: [{ name: contains }, { taxId: contains }],
        ...(ocultarTesorerias ? { type: { not: "TESORERIA" as const } } : {}),
      },
      select: { id: true, slug: true, name: true, taxId: true, type: true, supplierCategory: true },
      orderBy: { name: "asc" },
      take: TAKE_POR_TIPO,
    }),
    prisma.item.findMany({
      where: { name: contains },
      select: { id: true, slug: true, name: true, unit: true, category: true },
      orderBy: { name: "asc" },
      take: TAKE_POR_TIPO,
    }),
    prisma.product.findMany({
      where: {
        OR: [{ name: contains }, { oilType: contains }, { presentation: contains }],
      },
      select: {
        id: true,
        slug: true,
        name: true,
        oilType: true,
        presentation: true,
        bottleCapacityMl: true,
      },
      orderBy: [{ name: "asc" }, { oilType: "asc" }],
      take: TAKE_POR_TIPO,
    }),
    prisma.document.findMany({
      where: {
        type: "REMITO",
        number: { contains: numeroTerm, mode: "insensitive" },
        OR: [{ lines: { some: {} } }, { purchaseLines: { some: {} } }],
      },
      select: {
        id: true,
        number: true,
        date: true,
        lines: { select: { id: true }, take: 1 },
        purchaseLines: { select: { id: true }, take: 1 },
        account: { select: { entity: { select: { name: true } } } },
      },
      orderBy: { date: "desc" },
      // Se pide de más para poder deduplicar remitos mixtos Blanco+Negro antes de recortar.
      take: TAKE_POR_TIPO * 4,
    }),
    pareceCuit(term)
      ? prisma.entity.findMany({
          where: {
            taxId: { not: null },
            ...(ocultarTesorerias ? { type: { not: "TESORERIA" as const } } : {}),
          },
          select: { id: true, slug: true, name: true, taxId: true, type: true, supplierCategory: true },
          orderBy: { name: "asc" },
        })
      : Promise.resolve([]),
  ]);

  const scored: Scored[] = [];

  // --- Entidades (más las que matchean por CUIT normalizado sin guiones) ---
  const digitos = soloDigitos(term);
  const entidadesPorCuit = porCuit.filter(
    (e) => digitos.length >= 3 && soloDigitos(e.taxId ?? "").includes(digitos)
  );
  const entidadesUnicas = new Map(
    [...entidades, ...entidadesPorCuit].map((e) => [e.id, e])
  );

  for (const entity of Array.from(entidadesUnicas.values()).slice(0, TAKE_POR_TIPO)) {
    const contexto =
      entity.type === "TESORERIA"
        ? `${ENTITY_TYPE_LABELS.TESORERIA} · Cuenta Blanco`
        : entity.taxId
          ? `${ENTITY_TYPE_LABELS[entity.type]} · ${entity.taxId}`
          : entity.supplierCategory
            ? `${ENTITY_TYPE_LABELS[entity.type]} · ${SUPPLIER_CATEGORY_LABELS[entity.supplierCategory]}`
            : ENTITY_TYPE_LABELS[entity.type];

    scored.push({
      score: bestScore([entity.name, entity.taxId], term),
      result: {
        kind: kindDeEntidad(entity.type),
        id: entity.id,
        label: entity.name,
        sublabel: contexto,
        href: hrefDeEntidad(entity.slug, entity.type),
      },
    });
  }

  // --- Insumos ---
  for (const item of insumos) {
    scored.push({
      score: matchScore(item.name, term),
      result: {
        kind: "insumo",
        id: item.id,
        label: item.name,
        sublabel: `${SUPPLIER_CATEGORY_LABELS[item.category]} · ${item.unit}`,
        href: `/stock/${item.slug}`,
      },
    });
  }

  // --- Productos ---
  for (const product of productos) {
    scored.push({
      score: bestScore([product.name, product.oilType, product.presentation], term),
      result: {
        kind: "producto",
        id: product.id,
        // El label completo es obligatorio: dos productos comparten marca y envase, y solo los
        // distingue el tipo de aceite.
        label: formatProductLabel(product),
        sublabel: product.presentation,
        href: `/produccion/${product.slug}`,
      },
    });
  }

  // --- Comprobantes: un remito mixto son dos Document con el mismo número y la misma URL ---
  const vistos = new Set<string>();
  let documentosAgregados = 0;
  for (const doc of documentos) {
    if (documentosAgregados >= TAKE_POR_TIPO) break;
    const kind: SearchResultKind = doc.lines.length > 0 ? "entrega" : "compra";
    const clave = `${kind}|${doc.number}`;
    if (vistos.has(clave)) continue;
    vistos.add(clave);
    documentosAgregados++;

    scored.push({
      score: matchScore(doc.number, numeroTerm),
      result: {
        kind,
        id: doc.id,
        label: `Remito #${doc.number}`,
        sublabel: `${doc.account.entity.name} · ${doc.date.toLocaleDateString("es-AR")}`,
        href: `${kind === "entrega" ? "/entregas" : "/compras"}?q=${encodeURIComponent(doc.number)}`,
      },
    });
  }

  // El grupo hereda el mejor puntaje de sus miembros, así "900" sube los remitos al tope pero
  // "bufa" deja las entidades primero. Los grupos nunca se entremezclan: el cliente dibuja los
  // encabezados recorriendo esta lista plana.
  const puntajePorGrupo = new Map<SearchResultKind, number>();
  for (const { result, score } of scored) {
    puntajePorGrupo.set(result.kind, Math.max(puntajePorGrupo.get(result.kind) ?? 0, score));
  }

  return scored
    .sort((a, b) => {
      const grupoA = puntajePorGrupo.get(a.result.kind) ?? 0;
      const grupoB = puntajePorGrupo.get(b.result.kind) ?? 0;
      if (grupoA !== grupoB) return grupoB - grupoA;

      const ordenA = KIND_ORDER.indexOf(a.result.kind);
      const ordenB = KIND_ORDER.indexOf(b.result.kind);
      if (ordenA !== ordenB) return ordenA - ordenB;

      if (a.score !== b.score) return b.score - a.score;
      return a.result.label.localeCompare(b.result.label, "es");
    })
    .map((s) => s.result);
}
