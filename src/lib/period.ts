/**
 * Rango de fechas para reportes. `from` es inclusivo y **`to` es exclusivo** (mismo criterio que
 * los `gte`/`lt` de Prisma que ya se usan en los filtros) — en la UI se muestra siempre el día
 * anterior a `to`, que es el que el usuario eligió. Tenerlo presente: es la fuente clásica de
 * errores de un día.
 */
export type Period = { from: Date; to: Date };

export type PeriodPresetKey = "semana" | "mes" | "mes-pasado" | "anio";

export const PERIOD_PRESETS: { key: PeriodPresetKey; label: string }[] = [
  { key: "semana", label: "Esta semana" },
  { key: "mes", label: "Este mes" },
  { key: "mes-pasado", label: "Mes pasado" },
  { key: "anio", label: "Este año" },
];

export function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export function addDays(date: Date, days: number): Date {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy;
}

/** Fecha en formato `yyyy-mm-dd` para un `<input type="date">`, en hora local (no UTC). */
export function toDateInputValue(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** Semana corriente, de lunes a lunes (el domingo cuenta como último día de la semana). */
export function weekPeriod(reference: Date = new Date()): Period {
  const start = startOfDay(reference);
  const weekday = (start.getDay() + 6) % 7; // lunes = 0
  const from = addDays(start, -weekday);
  return { from, to: addDays(from, 7) };
}

export function monthPeriod(reference: Date = new Date()): Period {
  return {
    from: new Date(reference.getFullYear(), reference.getMonth(), 1),
    to: new Date(reference.getFullYear(), reference.getMonth() + 1, 1),
  };
}

export function lastMonthPeriod(reference: Date = new Date()): Period {
  return {
    from: new Date(reference.getFullYear(), reference.getMonth() - 1, 1),
    to: new Date(reference.getFullYear(), reference.getMonth(), 1),
  };
}

export function yearPeriod(reference: Date = new Date()): Period {
  return {
    from: new Date(reference.getFullYear(), 0, 1),
    to: new Date(reference.getFullYear() + 1, 0, 1),
  };
}

function periodFromPreset(preset: PeriodPresetKey, reference: Date): Period {
  switch (preset) {
    case "semana":
      return weekPeriod(reference);
    case "mes-pasado":
      return lastMonthPeriod(reference);
    case "anio":
      return yearPeriod(reference);
    case "mes":
    default:
      return monthPeriod(reference);
  }
}

function parseDateInput(value: string | undefined): Date | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  const parsed = new Date(`${trimmed}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * Resuelve el período a partir de los searchParams de una página. Un `desde`/`hasta` explícito
 * gana sobre el preset; si no hay nada, el default es el mes corriente. El `hasta` que elige el
 * usuario es inclusivo, así que se le suma un día para convertirlo en el `to` exclusivo.
 */
export function periodFromSearchParams(searchParams: {
  preset?: string;
  from?: string;
  to?: string;
}): { period: Period; preset: PeriodPresetKey | null } {
  const from = parseDateInput(searchParams.from);
  const to = parseDateInput(searchParams.to);

  if (from || to) {
    const fallback = monthPeriod();
    return {
      period: {
        from: from ?? fallback.from,
        to: to ? addDays(to, 1) : fallback.to,
      },
      preset: null,
    };
  }

  const presetKey = PERIOD_PRESETS.find((p) => p.key === searchParams.preset)?.key ?? "mes";
  return { period: periodFromPreset(presetKey, new Date()), preset: presetKey };
}

/** Último día incluido en el período (o sea `to` menos un día), que es el que se le muestra al usuario. */
export function periodLastDay(period: Period): Date {
  return addDays(period.to, -1);
}

export function formatPeriodLabel(period: Period): string {
  const desde = period.from.toLocaleDateString("es-AR");
  const hasta = periodLastDay(period).toLocaleDateString("es-AR");
  return `${desde} – ${hasta}`;
}
