import Link from "next/link";
import { requireRole } from "@/lib/auth-helpers";
import { getAccountBalance, getTreasuries } from "@/lib/ledger";
import { Wallet } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { formatMoney, sumDecimals } from "@/lib/money";
import { CIRCUIT_LABELS } from "@/lib/labels";
import { CAJA_CHICA_SLUG } from "@/lib/caja";

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

  const cards = await Promise.all(
    treasuries.map(async (treasury) => {
      const blanco = treasury.accounts.find((a) => a.circuit === "BLANCO");
      const negro = treasury.accounts.find((a) => a.circuit === "NEGRO");
      const [blancoSaldo, negroSaldo] = await Promise.all([
        blanco ? getAccountBalance(blanco.id) : null,
        negro ? getAccountBalance(negro.id) : null,
      ]);
      const total = (blancoSaldo?.toNumber() ?? 0) + (negroSaldo?.toNumber() ?? 0);
      return { treasury, blanco, negro, blancoSaldo, negroSaldo, total };
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
        {cards.map(({ treasury, blanco, negro, blancoSaldo, negroSaldo, total }) => (
          <div key={treasury.id} className="rounded-xl border border-foreground/10 bg-background shadow-sm p-5 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold">{treasury.name}</h2>
              <p className="text-lg font-semibold">{formatMoney(total)}</p>
            </div>
            {treasury.slug === CAJA_CHICA_SLUG ? (
              // La caja chica se lleva entera en Negro y tiene su propia pantalla, que es la que
              // usa la secretaría: mostrar acá un recuadro de Blanco siempre en cero sería ruido.
              <Link
                href="/caja-chica"
                className="block rounded-lg border border-foreground/10 p-3 text-sm hover:bg-foreground/5 transition-colors"
              >
                <p className="text-foreground/60">Efectivo del cajón</p>
                <p className="font-medium">{negroSaldo ? formatMoney(negroSaldo) : "—"}</p>
              </Link>
            ) : (
            <div className="grid grid-cols-2 gap-3 text-sm">
              {blanco && (
                <Link
                  href={`/cuentas-corrientes/${treasury.slug}/blanco`}
                  className="rounded-lg border border-foreground/10 p-3 hover:bg-foreground/5 transition-colors"
                >
                  <p className="text-foreground/60">{CIRCUIT_LABELS.BLANCO}</p>
                  <p className="font-medium">{blancoSaldo ? formatMoney(blancoSaldo) : "—"}</p>
                </Link>
              )}
              {negro && (
                <Link
                  href={`/cuentas-corrientes/${treasury.slug}/negro`}
                  className="rounded-lg border border-foreground/10 p-3 hover:bg-foreground/5 transition-colors"
                >
                  <p className="text-foreground/60">{CIRCUIT_LABELS.NEGRO}</p>
                  <p className="font-medium">{negroSaldo ? formatMoney(negroSaldo) : "—"}</p>
                </Link>
              )}
            </div>
            )}
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
