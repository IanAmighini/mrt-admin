import Link from "next/link";
import { AlertTriangle, Scale, TrendingDown, TrendingUp } from "lucide-react";
import { formatMoney, formatNumeroEditable } from "@/lib/money";
import { KpiCard } from "@/components/KpiCard";
import { FormModal } from "@/components/Modal";
import { ContribuyenteFields } from "@/components/ContribuyenteFields";
import { updateContribuyente } from "../actions";
import { getLibroIva, type RenglonIva, type TotalesIva } from "@/lib/libro-iva";
import type { Period } from "@/lib/period";

const thClass = "py-2 pr-4 text-left font-medium";
const thNum = "py-2 pr-4 text-right font-medium";
const tdNum = "py-2 pr-4 text-right tabular-nums";

export async function LibroIvaSection({ period }: { period: Period }) {
  const libro = await getLibroIva(period);
  const aFavor = libro.saldoIva.lessThan(0);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-foreground/10 bg-background p-4">
        <div className="text-sm">
          <p className="font-semibold">{libro.contribuyente.nombre}</p>
          <p className="text-foreground/60">
            C.U.I.T. {libro.contribuyente.cuit} · Período {libro.periodoTitulo}
          </p>
        </div>
        <FormModal
          triggerLabel="Datos del contribuyente"
          iconName="edit"
          title="Datos del contribuyente"
          action={updateContribuyente}
        >
          <ContribuyenteFields defaultValues={libro.contribuyente} />
        </FormModal>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <KpiCard label="IVA débito (ventas)" value={formatMoney(libro.totalesVentas.iva)} icon={TrendingUp} color="green" />
        <KpiCard label="IVA crédito (compras)" value={formatMoney(libro.totalesCompras.iva)} icon={TrendingDown} color="blue" />
        <KpiCard
          label={aFavor ? "Saldo a favor" : "Saldo a pagar"}
          value={formatMoney(aFavor ? libro.saldoIva.negated() : libro.saldoIva)}
          icon={Scale}
          color={aFavor ? "amber" : "red"}
        />
      </div>

      {libro.remitosSinFacturar.length > 0 && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm dark:border-amber-900/50 dark:bg-amber-950/30">
          <p className="flex items-center gap-2 font-medium text-amber-900 dark:text-amber-200">
            <AlertTriangle className="h-4 w-4" />
            {libro.remitosSinFacturar.length === 1
              ? "Hay un comprobante en Blanco sin facturar en este período"
              : `Hay ${libro.remitosSinFacturar.length} comprobantes en Blanco sin facturar en este período`}
          </p>
          <p className="mt-1 text-amber-800 dark:text-amber-300">
            Ni un remito ni una compra son comprobantes fiscales, así que no entran al libro. Esa
            venta —o ese crédito fiscal— no está declarada hasta que se cargue la factura.
          </p>
          <ul className="mt-2 space-y-0.5 text-amber-900 dark:text-amber-200">
            {libro.remitosSinFacturar.map((r) => (
              <li key={`${r.number}-${r.date.toISOString()}`}>
                {r.sustantivo} #{r.number} — {r.entityName} — {r.date.toLocaleDateString("es-AR")} —{" "}
                {formatMoney(r.pendiente)} sin facturar
              </li>
            ))}
          </ul>
        </div>
      )}

      {libro.notasSinClasificar.length > 0 && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm dark:border-amber-900/50 dark:bg-amber-950/30">
          <p className="flex items-center gap-2 font-medium text-amber-900 dark:text-amber-200">
            <AlertTriangle className="h-4 w-4" />
            {libro.notasSinClasificar.length === 1
              ? "Hay una nota en Blanco que no entró al libro"
              : `Hay ${libro.notasSinClasificar.length} notas en Blanco que no entraron al libro`}
          </p>
          <p className="mt-1 text-amber-800 dark:text-amber-300">
            La cuenta es de una entidad marcada como “Ambos”, así que no se puede saber si la nota la
            emitimos nosotros o la recibimos. Cambiá la entidad a Cliente o a Proveedor y vuelve a
            calcularse sola.
          </p>
          <ul className="mt-2 space-y-0.5 text-amber-900 dark:text-amber-200">
            {libro.notasSinClasificar.map((n) => (
              <li key={`${n.number}-${n.date.toISOString()}`}>
                {n.tipo} #{n.number} — {n.entityName} — {n.date.toLocaleDateString("es-AR")}
              </li>
            ))}
          </ul>
        </div>
      )}

      <Planilla
        titulo="I.V.A. Ventas — Facturas A"
        aclaracion="Los comprobantes tipo Factura de la cuenta Blanco."
        columnaEntidad="Comprador"
        columnaPercepcion="RG 5329 3%"
        renglones={libro.ventas}
        totales={libro.totalesVentas}
        vacio="Sin facturas de venta en este período."
      />

      <Planilla
        titulo="I.V.A. Compras"
        aclaracion="Las facturas de los proveedores y las facturas de gasto, de la cuenta Blanco."
        columnaEntidad="Proveedor"
        columnaPercepcion="Percepciones"
        conConcepto
        renglones={libro.compras}
        totales={libro.totalesCompras}
        vacio="Sin compras ni gastos facturados en este período."
      />

      {(libro.alicuotasVentas.length > 0 || libro.alicuotasCompras.length > 0) && (
        <section>
          <h2 className="text-sm font-semibold mb-2">Por alícuota</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-foreground/10 text-foreground/60">
                  <th className={thClass}>Lado</th>
                  <th className={thClass}>Alícuota</th>
                  <th className={thNum}>Neto gravado</th>
                  <th className={thNum}>IVA</th>
                </tr>
              </thead>
              <tbody>
                {[
                  ...libro.alicuotasVentas.map((a) => ({ lado: "Ventas", ...a })),
                  ...libro.alicuotasCompras.map((a) => ({ lado: "Compras", ...a })),
                ].map((a) => (
                  <tr key={`${a.lado}-${a.rate.toString()}`} className="border-b border-foreground/5">
                    <td className="py-2 pr-4">{a.lado}</td>
                    <td className="py-2 pr-4">{formatNumeroEditable(a.rate, 1)} %</td>
                    <td className={tdNum}>{formatMoney(a.neto)}</td>
                    <td className={`${tdNum} font-medium`}>{formatMoney(a.iva)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <p className="text-xs text-foreground/50">
        Las notas de crédito restan: entran en negativo, así que la fila de totales ya es lo que se
        declara. Las notas en Negro y los ajustes manuales quedan fuera, porque no son comprobantes
        fiscales. <Link href="/cuentas-corrientes" className="underline underline-offset-2">Cuentas corrientes</Link>
      </p>
    </div>
  );
}

function Planilla({
  titulo,
  aclaracion,
  columnaEntidad,
  columnaPercepcion,
  conConcepto,
  renglones,
  totales,
  vacio,
}: {
  titulo: string;
  aclaracion: string;
  columnaEntidad: string;
  columnaPercepcion: string;
  conConcepto?: boolean;
  renglones: RenglonIva[];
  totales: TotalesIva;
  vacio: string;
}) {
  const columnas = conConcepto ? 10 : 9;

  return (
    <section>
      <h2 className="text-sm font-semibold">{titulo}</h2>
      <p className="mb-2 text-xs text-foreground/50">{aclaracion}</p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-foreground/10 text-foreground/60">
              <th className={thClass}>Fecha</th>
              <th className={thClass}>Comprobante</th>
              <th className={thClass}>Nro de Comp</th>
              <th className={thClass}>{columnaEntidad}</th>
              <th className={thClass}>Nro de Cuit</th>
              {conConcepto && <th className={thClass}>Concepto</th>}
              <th className={thNum}>Neto Gravado</th>
              <th className={thNum}>{columnaPercepcion}</th>
              <th className={thNum}>IVA</th>
              <th className={thNum}>Total</th>
            </tr>
          </thead>
          <tbody>
            {renglones.map((r, i) => (
              <tr key={`${r.number}-${i}`} className="border-b border-foreground/5">
                <td className="py-2 pr-4 whitespace-nowrap">{r.date.toLocaleDateString("es-AR")}</td>
                <td className="py-2 pr-4">{r.tipo}</td>
                <td className="py-2 pr-4">{r.number}</td>
                <td className="py-2 pr-4">{r.entityName}</td>
                <td className="py-2 pr-4 text-foreground/60">{r.taxId ?? "—"}</td>
                {conConcepto && <td className="py-2 pr-4 text-foreground/60">{r.concepto}</td>}
                <td className={tdNum}>{formatMoney(r.neto, r.currency)}</td>
                <td className={tdNum}>{formatMoney(r.percepcion, r.currency)}</td>
                <td className={tdNum}>{formatMoney(r.iva, r.currency)}</td>
                <td className={`${tdNum} font-medium`}>{formatMoney(r.total, r.currency)}</td>
              </tr>
            ))}
            {renglones.length === 0 && (
              <tr>
                <td colSpan={columnas} className="py-6 text-center text-foreground/40">
                  {vacio}
                </td>
              </tr>
            )}
          </tbody>
          {renglones.length > 0 && (
            <tfoot>
              <tr className="border-t border-foreground/20 font-semibold">
                <td className="py-2 pr-4" colSpan={conConcepto ? 6 : 5}>
                  TOTALES
                </td>
                <td className={tdNum}>{formatMoney(totales.neto)}</td>
                <td className={tdNum}>{formatMoney(totales.percepcion)}</td>
                <td className={tdNum}>{formatMoney(totales.iva)}</td>
                <td className={tdNum}>{formatMoney(totales.total)}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </section>
  );
}
