import Link from "next/link";
import Image from "next/image";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth-helpers";
import { formatMoney } from "@/lib/money";
import { PAYMENT_METHOD_LABELS, DOCUMENT_TYPE_LABELS } from "@/lib/labels";
import { formatNumeroOP, getOrdenPago } from "@/lib/orden-pago";
import { userErrorMessage } from "@/lib/user-error";
import { DeleteButton } from "@/components/DeleteButton";
import { anularOrdenPago } from "../actions";
import { PrintButton } from "@/components/PrintButton";

/** Con cero adelante, como en el papel que se venía llenando a mano: 07/09/2026, no 7/9/2026. */
const fecha = (d: Date) =>
  d.toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric" });

export default async function OrdenPagoPage({
  params,
}: {
  params: Promise<{ numero: string }>;
}) {
  const { numero } = await params;
  const user = await requireRole(["ADMIN", "SOLO_LECTURA", "SECRETARIA"]);
  const canEdit = user.role === "ADMIN" || user.role === "SECRETARIA";

  const n = Number(numero);
  if (!Number.isInteger(n)) notFound();

  let datos;
  try {
    datos = await getOrdenPago(n);
  } catch (e) {
    void userErrorMessage(e);
    notFound();
  }

  const { orden, emisor, comprobantes, totalFacturas, totalPagado, saldoAnterior, saldoPendiente, conceptos } = datos;
  const etiqueta = `OP N° ${formatNumeroOP(orden.numero)}`;
  const metodos = Array.from(new Set(orden.payments.map((p) => PAYMENT_METHOD_LABELS[p.method])));

  return (
    <div className="space-y-4">
      {/* Nada de esto sale impreso: la hoja empieza en el papel de abajo. */}
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link href="/ordenes-pago" className="text-sm underline underline-offset-2">
          ← Órdenes de pago
        </Link>
        <div className="flex items-center gap-2">
          <PrintButton />
          {canEdit && (
            <DeleteButton
              action={anularOrdenPago}
              hiddenName="numero"
              hiddenValue={String(orden.numero)}
              nombre={`la orden de pago N° ${formatNumeroOP(orden.numero)}`}
              consecuencia="Los pagos no se borran: vuelven a quedar disponibles para armar otra orden."
            />
          )}
        </div>
      </div>

      <div className="mx-auto w-full max-w-[820px] bg-white p-10 text-black shadow-sm print:p-0 print:shadow-none">
        <header className="flex items-start justify-between gap-6">
          <div className="flex items-center gap-4">
            <Image src="/logo.png" alt="" width={76} height={76} priority />
            <div>
              <p className="text-2xl font-bold tracking-tight">{emisor.nombre.toUpperCase()}</p>
              <p className="text-xs text-neutral-500">{emisor.direccion}</p>
              <p className="text-xs text-neutral-500">CUIT {emisor.cuit}</p>
            </div>
          </div>
          <div className="bg-neutral-900 px-8 py-5 text-center text-white">
            <p className="text-[11px] font-bold tracking-widest">ORDEN DE PAGO</p>
            <p className="text-2xl font-bold">N° {formatNumeroOP(orden.numero)}</p>
            <p className="mt-1 text-xs font-semibold">{fecha(orden.date)}</p>
          </div>
        </header>

        <div className="mt-6 h-[3px] w-full bg-yellow-400" />

        <section className="mt-5 border-l-4 border-yellow-400 bg-neutral-100 px-4 py-3 text-sm">
          <p>
            <strong>Beneficiario:</strong> {orden.entity.name}
            {orden.entity.taxId && (
              <>
                <span className="mx-3 text-neutral-400">|</span>
                <strong>CUIT:</strong> {orden.entity.taxId}
              </>
            )}
          </p>
          {comprobantes.map((c) => (
            <p key={c.id}>
              <strong>{DOCUMENT_TYPE_LABELS[c.type]}:</strong> N° {c.number}
              <span className="mx-2 text-neutral-400">|</span>
              <strong>Fecha:</strong> {fecha(c.date)}
              <span className="mx-2 text-neutral-400">|</span>
              <strong>Total:</strong> {formatMoney(c.total)}
            </p>
          ))}
          {conceptos && (
            <p>
              <strong>Concepto:</strong> {conceptos}
            </p>
          )}
        </section>

        <div className="mt-8 flex items-center justify-between bg-neutral-100 px-4 py-2 text-sm">
          <span className="italic text-neutral-600">Saldo anterior</span>
          <span className="font-semibold tabular-nums">{formatMoney(saldoAnterior)}</span>
        </div>

        <h2 className="mt-6 text-sm font-bold">
          Pago actual — {etiqueta} <span className="ml-2 font-normal">({metodos.join(" + ")})</span>
        </h2>
        <table className="mt-2 w-full text-sm">
          <thead>
            <tr className="bg-neutral-900 text-white">
              <th className="px-3 py-2 text-left font-bold">#</th>
              <th className="px-3 py-2 text-left font-bold">N° COMPROBANTE</th>
              <th className="px-3 py-2 text-left font-bold">FECHA PAGO</th>
              <th className="px-3 py-2 text-left font-bold">TIPO</th>
              <th className="px-3 py-2 text-right font-bold">IMPORTE</th>
            </tr>
          </thead>
          <tbody>
            {orden.payments.map((p, i) => (
              <tr key={p.id} className="border-b border-neutral-200">
                <td className="px-3 py-2">{i + 1}</td>
                {/* El comprobante del pago: el número del cheque si lo hubo, o la referencia. */}
                <td className="px-3 py-2">{p.chequeEntregado?.numero ?? p.reference ?? "—"}</td>
                <td className="px-3 py-2">{fecha(p.date)}</td>
                <td className="px-3 py-2">{PAYMENT_METHOD_LABELS[p.method]}</td>
                <td className="px-3 py-2 text-right tabular-nums">{formatMoney(p.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <h2 className="mt-10 text-sm font-bold">Resumen de cuenta</h2>
        <table className="mt-3 w-full text-sm">
          <tbody>
            {comprobantes.map((c) => (
              <tr key={c.id} className="bg-neutral-100">
                <td className="px-3 py-2">
                  Total {DOCUMENT_TYPE_LABELS[c.type].toLowerCase()} N° {c.number}
                </td>
                <td className="px-3 py-2 text-right font-semibold tabular-nums">{formatMoney(c.total)}</td>
              </tr>
            ))}
            <tr>
              <td className="px-3 py-2">Saldo anterior</td>
              <td className="px-3 py-2 text-right tabular-nums">{formatMoney(saldoAnterior)}</td>
            </tr>
            <tr className="bg-neutral-100">
              <td className="px-3 py-2">Pago actual — {etiqueta}</td>
              <td className="px-3 py-2 text-right tabular-nums">{formatMoney(totalPagado.negated())}</td>
            </tr>
            <tr className="bg-yellow-400">
              <td className="px-3 py-2 font-bold">Total pagado</td>
              <td className="px-3 py-2 text-right font-bold tabular-nums">
                {formatMoney(totalPagado.negated())}
              </td>
            </tr>
            <tr className="bg-neutral-900 text-white">
              <td className="px-3 py-2 font-bold">SALDO PENDIENTE</td>
              <td className="px-3 py-2 text-right font-bold tabular-nums">{formatMoney(saldoPendiente)}</td>
            </tr>
          </tbody>
        </table>

        {orden.notes && <p className="mt-6 text-sm text-neutral-600">{orden.notes}</p>}

        <div className="mt-24 grid grid-cols-2 gap-16 text-center text-sm">
          <div>
            <div className="border-t border-neutral-400 pt-2">
              <p className="italic text-neutral-500">Autorizado por</p>
              <p className="font-bold">{emisor.nombre}</p>
            </div>
          </div>
          <div>
            <div className="border-t border-neutral-400 pt-2">
              <p className="italic text-neutral-500">Conformidad Proveedor</p>
              <p className="font-bold">{orden.entity.name}</p>
            </div>
          </div>
        </div>

        {/* El total de facturas no se imprime aparte: ya está renglón por renglón arriba. */}
        <span className="hidden">{formatMoney(totalFacturas)}</span>
      </div>
    </div>
  );
}
