import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { formatMoney, formatQuantity, ZERO } from "@/lib/money";
import { formatFecha } from "@/lib/period";

/**
 * Los gráficos de los dashboards, dibujados con HTML y SVG: son barras y puntos, y una librería de
 * gráficos sería más peso que dibujo. Cada marca lleva su `title`, que es el tooltip del navegador,
 * y el número va siempre escrito al lado: el color identifica, no informa.
 *
 * Colores en orden fijo (azul, naranja, verde agua, amarillo, rojo), con su versión para el modo
 * oscuro. El rojo y el amarillo se reservan para lo vencido.
 */
export const COLOR = {
  azul: "bg-[#2a78d6] dark:bg-[#3987e5]",
  naranja: "bg-[#eb6834] dark:bg-[#d95926]",
  verde: "bg-[#1baf7a] dark:bg-[#199e70]",
  amarillo: "bg-[#eda100] dark:bg-[#c98500]",
  rojo: "bg-[#e34948] dark:bg-[#e66767]",
  gris: "bg-foreground/25",
} as const;
export type Color = keyof typeof COLOR;

/** "$ 271,0 M": en un gráfico los centavos no se leen y el millón alcanza. */
export function millones(n: Prisma.Decimal) {
  const m = n.dividedBy(1_000_000);
  return m.abs().greaterThanOrEqualTo(1) ? `$ ${formatQuantity(m.toDecimalPlaces(1))} M` : `$ ${formatQuantity(n.toDecimalPlaces(0))}`;
}

/** Un gráfico con su título, para poner arriba de las tablas de los reportes. */
export function Panel({ titulo, nota, children }: { titulo: string; nota?: string; children: React.ReactNode }) {
  return (
    <section className="min-w-0 rounded-xl border border-foreground/10 bg-background p-4 shadow-sm">
      <h3 className="text-sm font-semibold">{titulo}</h3>
      {nota && <p className="text-xs text-foreground/50">{nota}</p>}
      <div className="mt-3">{children}</div>
    </section>
  );
}

/** Pallets con un decimal como mucho: las cajas sueltas hacían "418,038", que no se lee. */
export function pallets(n: Prisma.Decimal) {
  return `${formatQuantity(n.toDecimalPlaces(1))} ${n.toDecimalPlaces(1).abs().equals(1) ? "pallet" : "pallets"}`;
}

/** Litros enteros. */
export function litros(n: Prisma.Decimal) {
  return formatQuantity(n.toDecimalPlaces(0), "L");
}

export function Referencia({ items }: { items: { nombre: string; color: Color; valor?: string }[] }) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-foreground/60">
      {items.map((i) => (
        <span key={i.nombre} className="flex items-center gap-1.5">
          <span className={`h-2.5 w-2.5 shrink-0 rounded-sm ${COLOR[i.color]}`} />
          {i.nombre}
          {i.valor && <span className="tabular-nums text-foreground/80">{i.valor}</span>}
        </span>
      ))}
    </div>
  );
}

/** Una sola barra partida en tramos que suman un total: la deuda por antigüedad. */
export function BarraDeTramos({ tramos }: { tramos: { nombre: string; valor: Prisma.Decimal; color: Color }[] }) {
  const conValor = tramos.filter((t) => t.valor.greaterThan(0));
  const total = conValor.reduce((acc, t) => acc.plus(t.valor), ZERO);
  if (total.isZero()) return <p className="text-sm text-foreground/50">Nadie debe nada.</p>;
  return (
    <div className="space-y-3">
      <div className="flex h-4 gap-0.5 overflow-hidden rounded">
        {conValor.map((t) => (
          <div
            key={t.nombre}
            className={COLOR[t.color]}
            style={{ flexGrow: t.valor.dividedBy(total).toNumber(), flexBasis: 0, minWidth: 3 }}
            title={`${t.nombre}: ${formatMoney(t.valor)}`}
          />
        ))}
      </div>
      <Referencia items={tramos.map((t) => ({ nombre: t.nombre, color: t.color, valor: millones(t.valor) }))} />
    </div>
  );
}

/**
 * Barras horizontales con el nombre a la izquierda y el número a la derecha. Cada barra puede
 * venir en partes (Cuenta 1 y Cuenta 2, o lo vencido de un cliente): las partes van una al lado de
 * la otra, en el mismo orden en todas las filas.
 */
export function Barras({
  filas,
  colorPorDefecto = "azul",
}: {
  filas: {
    clave: string;
    nombre: string;
    detalle?: string;
    href?: string;
    valor: Prisma.Decimal;
    texto?: string;
    partes?: { nombre: string; valor: Prisma.Decimal; color: Color }[];
  }[];
  colorPorDefecto?: Color;
}) {
  // Un renglón en cero no tiene barra que mostrar: el pallet descartable, que se compra sin cargo.
  filas = filas.filter((f) => !f.valor.isZero());
  const max = filas.reduce((acc, f) => (f.valor.greaterThan(acc) ? f.valor : acc), ZERO);
  if (filas.length === 0 || max.isZero()) return <p className="text-sm text-foreground/50">Nada en este período.</p>;
  return (
    <div className="space-y-2">
      {filas.map((f) => {
        const partes = f.partes?.filter((p) => p.valor.greaterThan(0)) ?? [{ nombre: f.nombre, valor: f.valor, color: colorPorDefecto }];
        const nombre = (
          <>
            <span className="block truncate">{f.nombre}</span>
            {f.detalle && <span className="block truncate text-xs text-foreground/50">{f.detalle}</span>}
          </>
        );
        return (
          <div key={f.clave} className="grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)_auto] items-center gap-3 text-sm sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)_auto]">
            {f.href ? (
              <Link href={f.href} className="min-w-0 hover:underline hover:underline-offset-2">
                {nombre}
              </Link>
            ) : (
              <span className="min-w-0">{nombre}</span>
            )}
            <div className="flex h-3 gap-0.5" style={{ width: `${Math.max(f.valor.dividedBy(max).toNumber() * 100, 1)}%` }}>
              {partes.map((p, i) => (
                <div
                  key={p.nombre}
                  className={`${COLOR[p.color]} ${i === partes.length - 1 ? "rounded-r" : ""}`}
                  style={{ flexGrow: p.valor.toNumber(), flexBasis: 0, minWidth: 2 }}
                  title={`${f.nombre} · ${p.nombre}: ${formatMoney(p.valor)}`}
                />
              ))}
            </div>
            <span className="text-right tabular-nums">{f.texto ?? millones(f.valor)}</span>
          </div>
        );
      })}
    </div>
  );
}

/** Columnas por semana, dos series lado a lado (lo entregado y lo cobrado). */
export function ColumnasPorSemana({
  semanas,
  series,
}: {
  semanas: { desde: Date; valores: Prisma.Decimal[] }[];
  series: { nombre: string; color: Color }[];
}) {
  const max = semanas.flatMap((s) => s.valores).reduce((acc, v) => (v.greaterThan(acc) ? v : acc), ZERO);
  return (
    <div className="space-y-3">
      <Referencia items={series} />
      <div className="flex h-36 items-end gap-2 border-b border-foreground/15 sm:gap-4">
        {semanas.map((s) => (
          <div key={s.desde.toISOString()} className="flex h-full flex-1 items-end justify-center gap-0.5">
            {s.valores.map((v, i) => (
              <div
                key={series[i].nombre}
                className={`w-full max-w-4 rounded-t ${COLOR[series[i].color]}`}
                style={{ height: max.isZero() ? 0 : `${Math.max(v.dividedBy(max).toNumber() * 100, v.isZero() ? 0 : 2)}%` }}
                title={`Semana del ${formatFecha(s.desde)} · ${series[i].nombre}: ${formatMoney(v)}`}
              />
            ))}
          </div>
        ))}
      </div>
      <div className="flex gap-2 text-[11px] text-foreground/50 sm:gap-4">
        {semanas.map((s) => (
          <span key={s.desde.toISOString()} className="flex-1 text-center tabular-nums">
            {formatFecha(s.desde).slice(0, -5)}
          </span>
        ))}
      </div>
    </div>
  );
}

/**
 * El precio de cada compra de aceite, en U$S por tonelada, una línea por aceite. Un punto que se
 * escapa de la línea es una compra cargada a otro precio: así se vio el remito 5242 a U$S 1.570.
 */
export function PreciosDeAceite({
  compras,
}: {
  compras: { fecha: Date; aceite: string; proveedor: string; numero: string; usdPorTonelada: Prisma.Decimal }[];
}) {
  if (compras.length === 0) return <p className="text-sm text-foreground/50">No hubo compras de aceite en los últimos 90 días.</p>;
  const colores: Color[] = ["azul", "naranja", "verde"];
  const STROKE: Record<Color, string> = {
    azul: "stroke-[#2a78d6] dark:stroke-[#3987e5]",
    naranja: "stroke-[#eb6834] dark:stroke-[#d95926]",
    verde: "stroke-[#1baf7a] dark:stroke-[#199e70]",
    amarillo: "",
    rojo: "",
    gris: "",
  };
  const FILL: Record<Color, string> = {
    azul: "fill-[#2a78d6] dark:fill-[#3987e5]",
    naranja: "fill-[#eb6834] dark:fill-[#d95926]",
    verde: "fill-[#1baf7a] dark:fill-[#199e70]",
    amarillo: "",
    rojo: "",
    gris: "",
  };
  const aceites = Array.from(new Set(compras.map((c) => c.aceite))).sort((a, b) =>
    a === "Girasol" ? -1 : b === "Girasol" ? 1 : a.localeCompare(b, "es")
  );
  const colorDe = new Map(aceites.map((a, i) => [a, colores[i % colores.length]]));
  const valores = compras.map((c) => c.usdPorTonelada.toNumber());
  const min = Math.floor((Math.min(...valores) - 40) / 50) * 50;
  const max = Math.ceil((Math.max(...valores) + 40) / 50) * 50;
  const t0 = compras[0].fecha.getTime();
  const t1 = Math.max(compras[compras.length - 1].fecha.getTime(), t0 + 1);
  const W = 600, H = 180, IZQ = 44, DER = 8, ARR = 8, ABA = 22;
  const x = (f: Date) => IZQ + ((f.getTime() - t0) / (t1 - t0)) * (W - IZQ - DER);
  const y = (v: number) => ARR + (1 - (v - min) / (max - min)) * (H - ARR - ABA);
  const marcas = Array.from({ length: Math.floor((max - min) / 100) + 1 }, (_, i) => min + i * 100).filter((v) => v <= max);
  const ultimo = (a: string) => [...compras].reverse().find((c) => c.aceite === a);

  return (
    <div className="space-y-3">
      <Referencia
        items={aceites.map((a) => ({
          nombre: a,
          color: colorDe.get(a)!,
          valor: `última U$S ${formatQuantity(ultimo(a)!.usdPorTonelada)}/t`,
        }))}
      />
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="Precio del aceite por compra, en dólares por tonelada">
        {marcas.map((v) => (
          <g key={v}>
            <line x1={IZQ} x2={W - DER} y1={y(v)} y2={y(v)} className="stroke-foreground/10" strokeWidth={1} />
            <text x={IZQ - 6} y={y(v) + 4} textAnchor="end" className="fill-foreground/50 text-[11px] tabular-nums">
              {formatQuantity(v)}
            </text>
          </g>
        ))}
        <text x={IZQ} y={H - 4} className="fill-foreground/50 text-[11px]">{formatFecha(compras[0].fecha)}</text>
        <text x={W - DER} y={H - 4} textAnchor="end" className="fill-foreground/50 text-[11px]">
          {formatFecha(compras[compras.length - 1].fecha)}
        </text>
        {aceites.map((a) => {
          const puntos = compras.filter((c) => c.aceite === a);
          const color = colorDe.get(a)!;
          return (
            <g key={a}>
              <polyline
                points={puntos.map((c) => `${x(c.fecha)},${y(c.usdPorTonelada.toNumber())}`).join(" ")}
                fill="none"
                strokeWidth={2}
                strokeLinejoin="round"
                strokeLinecap="round"
                className={STROKE[color]}
              />
              {puntos.map((c, i) => (
                <circle
                  key={`${c.numero}-${i}`}
                  cx={x(c.fecha)}
                  cy={y(c.usdPorTonelada.toNumber())}
                  r={4}
                  strokeWidth={2}
                  className={`${FILL[color]} stroke-background`}
                >
                  <title>{`${formatFecha(c.fecha)} · ${c.proveedor} #${c.numero} · ${a}: U$S ${formatQuantity(c.usdPorTonelada)}/t`}</title>
                </circle>
              ))}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
