import { hoyEnInput, parseFecha, toDateInputValue } from "./period";

/**
 * Lo que comparten las listas agrupadas por día (entregas, compras, cobros y pagos): los atajos de
 * período y cómo se titula cada día. Todo en el día de acá.
 */
export function diasDeReferencia() {
  const hoy = hoyEnInput();
  const menosDias = (n: number) => toDateInputValue(new Date(parseFecha(hoy).getTime() - n * 86_400_000));
  const inicioMes = `${hoy.slice(0, 8)}01`;
  const finMesPasado = toDateInputValue(new Date(parseFecha(inicioMes).getTime() - 86_400_000));
  return {
    hoy,
    ayer: menosDias(1),
    atajos: [
      { label: "Este mes", from: inicioMes, to: hoy },
      { label: "Mes pasado", from: `${finMesPasado.slice(0, 8)}01`, to: finMesPasado },
      { label: "Últimos 7 días", from: menosDias(6), to: hoy },
    ],
  };
}

/** "Hoy · martes 13/10", "Ayer · lunes 12/10", "Viernes 9/10" (con el año si no es este). */
export function tituloDelDia(d: string, hoy: string, ayer: string) {
  const fecha = parseFecha(d);
  const semana = fecha.toLocaleDateString("es-AR", { weekday: "long", timeZone: "UTC" });
  const corto = fecha.toLocaleDateString("es-AR", { day: "numeric", month: "numeric", timeZone: "UTC" });
  if (d === hoy) return `Hoy · ${semana} ${corto}`;
  if (d === ayer) return `Ayer · ${semana} ${corto}`;
  return `${semana[0].toUpperCase()}${semana.slice(1)} ${corto}${d.slice(0, 4) !== hoy.slice(0, 4) ? `/${d.slice(0, 4)}` : ""}`;
}

/** Agrupa por la fecha del día, en el orden en que vienen. */
export function agruparPorDia<T>(lista: T[], fecha: (x: T) => Date) {
  const porDia = new Map<string, T[]>();
  for (const x of lista) {
    const d = toDateInputValue(fecha(x));
    porDia.set(d, [...(porDia.get(d) ?? []), x]);
  }
  return Array.from(porDia.entries());
}
