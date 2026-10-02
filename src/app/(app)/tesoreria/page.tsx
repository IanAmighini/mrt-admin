import Link from "next/link";
import { requireRole } from "@/lib/auth-helpers";
import { getAccountBalance, getTreasuries } from "@/lib/ledger";
import { Wallet } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { formatMoney, sumDecimals } from "@/lib/money";
import { CIRCUIT_LABELS } from "@/lib/labels";
import { CAJA_CHICA_SLUG } from "@/lib/caja";
import { circuitoDeTesoreria } from "@/lib/pagos";

/** La caja de efectivo, que es donde están los cheques en papel. Se identifica por nombre, igual
 *  que "Banco Galicia" en el formulario de pago. */
const esLaCaja = (nombre: string) => nombre.toLowerCase().includes("caja");

export default async function TesoreriaPage() {
  await requireRole(["ADMIN", "SOLO_LECTURA"]);
  const [treasuries, cartera] = await Promise.all([
    getTreasuries(),
    prisma.cheque.findMany({ where: { estado: "EN_CARTERA" }, select: { amount: true, esEcheq: true } }),
  ]);

  // El papel está en la caja y el echeq en el banco, así que cada uno cuelga de donde vive.
  const resumen = (esEcheq: boolean) => {
    const propios = cartera.filter((c) => c.esEcheq === esEcheq);
    return {
      total: sumDecimals(propios.map((c) => c.amount)),
      count: `${propios.length} ${esEcheq ? "echeq" : "cheque"}${propios.length === 1 ? "" : "s"}`,
    };
  };

  // Cada tesorería tiene una sola cuenta —el banco Blanco, las cajas Negro—, así que su saldo es
  // ése y nada más. Ver `circuitoDeTesoreria`.
  const cards = await Promise.all(
    treasuries.map(async (treasury) => {
      const circuito = circuitoDeTesoreria(treasury.name);
      const cuenta = treasury.accounts.find((a) => a.circuit === circuito);
      const saldo = cuenta ? await getAccountBalance(cuenta.id) : null;
      return { treasury, circuito, saldo };
    })
  );

  return (
    <div className="space-y-10">
      <div>
        <h1 className="text-xl font-semibold mb-1">Tesorería</h1>
        <p className="text-sm text-foreground/60">
          Saldo del banco y de las dos cajas — se actualiza solo con cada cobro/pago que se asigna
          a una de ellas, más los movimientos manuales (comisiones, impuestos, retiros, depósitos)
          y lo que se carga en la caja chica.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {cards.map(({ treasury, circuito, saldo }) => (
          <div key={treasury.id} className="rounded-xl border border-foreground/10 bg-background shadow-sm p-5 space-y-3">
            <Link
              href={treasury.slug === CAJA_CHICA_SLUG ? "/caja-chica" : `/cuentas-corrientes/${treasury.slug}/${circuito.toLowerCase()}`}
              className="-m-2 flex items-center justify-between rounded-lg p-2 transition-colors hover:bg-foreground/5"
            >
              <div>
                <h2 className="text-sm font-semibold">{treasury.name}</h2>
                <p className="text-xs text-foreground/50">
                  {treasury.slug === CAJA_CHICA_SLUG ? "Efectivo del cajón" : CIRCUIT_LABELS[circuito]}
                </p>
              </div>
              {/* En rojo si está en negativo: una caja no puede tener menos que nada, así que eso
                  siempre es algo sin cargar o mal cargado, y tiene que saltar a la vista. */}
              <p className={`text-lg font-semibold ${saldo?.isNegative() ? "text-red-600 dark:text-red-400" : ""}`}>
                {saldo ? formatMoney(saldo) : "—"}
              </p>
            </Link>
            {/* No suman al saldo: un cheque no es plata hasta que se cobra. Los cheques viven en la
                caja grande y los echeqs en el banco; la caja chica no guarda ninguno. */}
            {treasury.slug !== CAJA_CHICA_SLUG && (() => {
              const esEcheq = !esLaCaja(treasury.name);
              const { total, count } = resumen(esEcheq);
              return (
                <Link
                  href={`/tesoreria/cheques?tipo=${esEcheq ? "echeq" : "fisico"}`}
                  className="flex items-center justify-between rounded-lg border border-foreground/10 p-3 text-sm hover:bg-foreground/5 transition-colors"
                >
                  <span className="flex items-center gap-2">
                    <Wallet size={15} className="text-foreground/40" />
                    {esEcheq ? "Echeqs en cartera" : "Cheques en cartera"}
                  </span>
                  <span className="font-medium">
                    {formatMoney(total)}
                    <span className="ml-2 text-xs text-foreground/50">{count}</span>
                  </span>
                </Link>
              );
            })()}
          </div>
        ))}
        {cards.length === 0 && (
          <p className="text-sm text-foreground/40">Todavía no hay cuentas de tesorería cargadas.</p>
        )}
      </div>
    </div>
  );
}
