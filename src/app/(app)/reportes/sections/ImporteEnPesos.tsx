import type { Currency, Prisma } from "@prisma/client";
import { formatMoney, ZERO } from "@/lib/money";

/**
 * Un importe de reporte: el total en pesos —lo que estaba en dólares ya convertido con la cotización
 * del día— y, si una parte eran dólares, cuántos, para que se vea de dónde sale el número.
 */
export function ImporteEnPesos({ porMoneda }: { porMoneda: Map<Currency, Prisma.Decimal> }) {
  const dolares = porMoneda.get("USD");
  return (
    <>
      {formatMoney(porMoneda.get("ARS") ?? ZERO)}
      {dolares && !dolares.isZero() && (
        <span className="block text-xs font-normal text-foreground/50">incluye {formatMoney(dolares, "USD")}</span>
      )}
    </>
  );
}
