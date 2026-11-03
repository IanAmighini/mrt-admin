import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { formatMoney, sumDecimals } from "@/lib/money";
import type { Balance, LineaDeBalance } from "@/lib/balance";

const verde = "text-green-700 dark:text-green-400";
const rojo = "text-red-600 dark:text-red-400";
const color = (n: Prisma.Decimal) => (n.isNegative() ? rojo : n.isZero() ? "" : verde);
const conSigno = (n: Prisma.Decimal) => `${n.isNegative() ? "−" : n.isZero() ? "" : "+"} ${formatMoney(n.abs())}`.trim();
const importe = (n: Prisma.Decimal) => (n.isZero() ? "—" : formatMoney(n));

/**
 * Activo, pasivo y patrimonio neto al empezar y al cerrar el mes. Cada renglón con su gente abajo,
 * cerrada: quién debe cuánto se mira cuando hace falta, y sin eso la tabla se lee de un vistazo.
 */
export function BalanceTabla({ balance, ini, fin }: { balance: Balance; ini: string; fin: string }) {
  const { activo, pasivo, totalActivo, totalPasivo, patrimonio, retiros } = balance;
  const difPN = patrimonio.cierre.minus(patrimonio.inicio);
  return (
    <section className="overflow-hidden rounded-xl border border-foreground/10 bg-background shadow-sm">
      <h3 className="border-b border-foreground/10 bg-foreground/[0.03] px-4 py-2.5 font-semibold">Balance</h3>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[36rem] table-fixed text-sm">
          <Columnas />
          <thead>
            <tr className="text-left text-xs text-foreground/50">
              <th className="px-4 py-2 font-medium" />
              <th className="px-4 py-2 text-right font-medium">Al {ini}</th>
              <th className="px-4 py-2 text-right font-medium">Al {fin}</th>
              <th className="px-4 py-2 text-right font-medium">Diferencia</th>
            </tr>
          </thead>
          <tbody className="tabular-nums">
            <Grupo titulo="Activo" detalle="lo que hay y lo que nos deben" lineas={activo} total={totalActivo} />
            <Grupo titulo="Pasivo" detalle="lo que debemos" lineas={pasivo} total={totalPasivo} />
            <tr className="border-t-2 border-foreground/15 font-semibold">
              <td className="px-4 py-2.5">
                Patrimonio neto
                <span className="block text-xs font-normal text-foreground/50">activo menos pasivo</span>
              </td>
              <td className="whitespace-nowrap px-4 py-2.5 text-right">{formatMoney(patrimonio.inicio)}</td>
              <td className="whitespace-nowrap px-4 py-2.5 text-right">{formatMoney(patrimonio.cierre)}</td>
              <td className={`whitespace-nowrap px-4 py-2.5 text-right ${color(difPN)}`}>{conSigno(difPN)}</td>
            </tr>
            {retiros.length > 0 && <Retiros retiros={retiros} />}
          </tbody>
        </table>
      </div>
      <div className="space-y-1.5 border-t border-foreground/5 px-4 py-2.5 text-xs text-foreground/50">
        <p>
          Los cheques y echeqs ya están dentro del saldo de la caja donde entraron: acá van aparte, sin contarlos dos
          veces. Los saldos en dólares, a la cotización de cada fecha. No incluye el IVA ni los impuestos a favor o a
          pagar.
        </p>
        {retiros.length > 0 && (
          <p>
            El retiro societario no entra en el activo ni en el pasivo: lo que se llevaron los socios no se va a cobrar, y
            lo que pusieron de más no es una deuda con terceros. Cuenta cuánto varió: si baja, pusieron más de lo que se
            llevaron —aportes, aceite entregado— y eso es parte de lo que subió el patrimonio.
          </p>
        )}
      </div>
    </section>
  );
}

/** Fuera del balance: el saldo a favor nuestro de cada cuenta de retiro y cuánto varió en el mes. */
function Retiros({ retiros }: { retiros: Balance["retiros"] }) {
  const dif = sumDecimals(retiros.map((r) => r.cierre)).minus(sumDecimals(retiros.map((r) => r.inicio)));
  return (
    <>
      <tr className="border-t border-foreground/10 bg-foreground/[0.02]">
        <td colSpan={4} className="px-4 py-1.5 text-xs font-semibold uppercase tracking-wide text-foreground/60">
          Retiro societario{" "}
          <span className="font-normal normal-case tracking-normal text-foreground/40">· fuera del balance, lo que tienen retirado los socios</span>
        </td>
      </tr>
      {retiros.map((r) => (
        <tr key={r.nombre} className="border-t border-foreground/5">
          <td className="px-4 py-2">
            {r.slug ? (
              <Link href={`/cuentas-corrientes/${r.slug}`} className="hover:underline hover:underline-offset-2">
                {r.nombre}
              </Link>
            ) : (
              r.nombre
            )}
            <span className="block text-xs text-foreground/50">{queHizo(r.cierre.minus(r.inicio))}</span>
          </td>
          <td className="whitespace-nowrap px-4 py-2 text-right">{importe(r.inicio)}</td>
          <td className="whitespace-nowrap px-4 py-2 text-right">{importe(r.cierre)}</td>
          <td className="whitespace-nowrap px-4 py-2 text-right text-foreground/70">{conSigno(r.cierre.minus(r.inicio))}</td>
        </tr>
      ))}
      <tr className="border-t border-foreground/10 font-semibold">
        <td className="px-4 py-2">
          Variación del retiro societario
          <span className="block text-xs font-normal text-foreground/50">{queHizo(dif, true)}</span>
        </td>
        <td />
        <td />
        <td className="whitespace-nowrap px-4 py-2 text-right">{conSigno(dif)}</td>
      </tr>
    </>
  );
}

/** Si el saldo a favor subió, se llevaron más de lo que pusieron; si bajó, al revés. */
function queHizo(dif: Prisma.Decimal, plural = false) {
  if (dif.isZero()) return "sin cambios en el mes";
  return dif.isPositive()
    ? `${plural ? "se llevaron" : "se llevó"} ${formatMoney(dif)} más de lo que ${plural ? "pusieron" : "puso"}`
    : `${plural ? "pusieron" : "puso"} ${formatMoney(dif.abs())} más de lo que se ${plural ? "llevaron" : "llevó"}`;
}

function Grupo({
  titulo,
  detalle,
  lineas,
  total,
}: {
  titulo: string;
  detalle: string;
  lineas: LineaDeBalance[];
  total: { inicio: Prisma.Decimal; cierre: Prisma.Decimal };
}) {
  const dif = total.cierre.minus(total.inicio);
  return (
    <>
      <tr className="border-t border-foreground/10 bg-foreground/[0.02]">
        <td colSpan={4} className="px-4 py-1.5 text-xs font-semibold uppercase tracking-wide text-foreground/60">
          {titulo} <span className="font-normal normal-case tracking-normal text-foreground/40">· {detalle}</span>
        </td>
      </tr>
      {lineas.map((l) => (
        <Renglon key={l.clave} linea={l} />
      ))}
      <tr className="border-t border-foreground/10 font-semibold">
        <td className="px-4 py-2">Total {titulo.toLowerCase()}</td>
        <td className="whitespace-nowrap px-4 py-2 text-right">{formatMoney(total.inicio)}</td>
        <td className="whitespace-nowrap px-4 py-2 text-right">{formatMoney(total.cierre)}</td>
        <td className="whitespace-nowrap px-4 py-2 text-right text-foreground/70">{conSigno(dif)}</td>
      </tr>
    </>
  );
}

function Renglon({ linea }: { linea: LineaDeBalance }) {
  const dif = linea.cierre.minus(linea.inicio);
  return (
    <>
      <tr className="border-t border-foreground/5">
        <td className="px-4 py-2">
          {linea.etiqueta}
          {linea.detalle && <span className="block text-xs text-foreground/50">{linea.detalle}</span>}
        </td>
        <td className="whitespace-nowrap px-4 py-2 text-right">{importe(linea.inicio)}</td>
        <td className="whitespace-nowrap px-4 py-2 text-right">{importe(linea.cierre)}</td>
        <td className="whitespace-nowrap px-4 py-2 text-right text-foreground/70">{conSigno(dif)}</td>
      </tr>
      {linea.filas.length > 1 && (
        <tr>
          <td colSpan={4} className="pb-2">
            <details className="text-xs">
              <summary className="cursor-pointer px-4 text-foreground/50 hover:text-foreground/80">
                Ver los {linea.filas.length}
              </summary>
              {/* Las mismas columnas que la tabla de afuera, para que cada importe caiga debajo de su fecha. */}
              <table className="mt-1 w-full table-fixed">
                <Columnas />
                <tbody className="tabular-nums">
                  {linea.filas.map((f) => (
                    <tr key={f.nombre} className="border-t border-foreground/5">
                      <td className="truncate py-1 pl-8 pr-4" title={f.nombre}>
                        {f.slug ? (
                          <Link href={`/cuentas-corrientes/${f.slug}`} className="underline underline-offset-2">
                            {f.nombre}
                          </Link>
                        ) : (
                          f.nombre
                        )}
                      </td>
                      <td className="whitespace-nowrap px-4 py-1 text-right text-foreground/60">{importe(f.inicio)}</td>
                      <td className="whitespace-nowrap px-4 py-1 text-right">{importe(f.cierre)}</td>
                      <td />
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          </td>
        </tr>
      )}
    </>
  );
}

/** El ancho de cada columna, igual en la tabla y en el detalle de cada renglón. */
function Columnas() {
  return (
    <colgroup>
      <col className="w-[34%]" />
      <col className="w-[22%]" />
      <col className="w-[22%]" />
      <col className="w-[22%]" />
    </colgroup>
  );
}
