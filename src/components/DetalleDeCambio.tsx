"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { ChevronRight, X } from "lucide-react";
import type { CambioDeCampo } from "@/lib/audit";
import { Table, TableEmpty, Td, Th, Thead, Tr } from "@/components/ui/Table";

export type FilaDeActividad = {
  id: string;
  cuando: string;
  usuario: string;
  accion: string;
  accionColor: string;
  tipo: string;
  resumen: string;
  cambios: CambioDeCampo[] | null;
  destino?: string;
};

/**
 * La tabla de Actividad, con el detalle de cada operación a un clic.
 *
 * El detalle va en un diálogo y no desplegando la fila porque la tabla ya tiene cinco columnas y
 * el detalle es una tabla propia: adentro habría que elegir cuál de las dos se lee.
 *
 * El diálogo es **uno solo** para toda la tabla, con la fila elegida en estado. Uno por fila
 * —que es lo natural si el disparador se arma junto con la fila— deja doscientos diálogos en el
 * DOM de una página que muestra doscientas operaciones, y la mayoría no se abre nunca.
 */
export function TablaDeActividad({
  filas,
  hayFiltro,
}: {
  filas: FilaDeActividad[];
  hayFiltro: boolean;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [elegida, setElegida] = useState<FilaDeActividad | null>(null);

  // El estado se fija al ABRIR y no al cerrar: el evento `close` del <dialog> no llega de forma
  // confiable, y limpiarlo ahí dejaba el diálogo con el contenido de la vez anterior.
  const abrir = (fila: FilaDeActividad) => {
    setElegida(fila);
    dialogRef.current?.showModal();
  };

  return (
    <>
      <Table apilada>
        <Thead>
          <Th>Fecha</Th>
          <Th>Usuario</Th>
          <Th>Acción</Th>
          <Th>Tipo</Th>
          <Th>Resumen</Th>
        </Thead>
        <tbody>
          {filas.map((fila) => (
            <Tr key={fila.id} className="hover:bg-foreground/[0.03]">
              <Td className="whitespace-nowrap">{fila.cuando}</Td>
              <Td className="whitespace-nowrap">{fila.usuario}</Td>
              <Td>
                <span className={`rounded px-2 py-1 text-xs font-medium ${fila.accionColor}`}>
                  {fila.accion}
                </span>
              </Td>
              <Td>{fila.tipo}</Td>
              {/* En el teléfono, en su propio renglón: es lo que se lee. */}
              <Td className="max-sm:basis-full">
                <button
                  type="button"
                  onClick={() => abrir(fila)}
                  className="flex w-full items-center justify-between gap-2 text-left underline-offset-2 hover:underline"
                >
                  <span>{fila.resumen}</span>
                  <ChevronRight size={16} className="shrink-0 text-foreground/25" />
                </button>
              </Td>
            </Tr>
          ))}
          {filas.length === 0 && (
            <TableEmpty colSpan={5}>
              {hayFiltro ? "No hay actividad con este filtro." : "Todavía no hay actividad registrada."}
            </TableEmpty>
          )}
        </tbody>
      </Table>

      <dialog
        ref={dialogRef}
        className="fixed inset-0 m-auto w-[calc(100%-1.5rem)] max-h-[calc(100dvh-1.5rem)] max-w-2xl rounded-xl border border-foreground/10 bg-background p-0 text-foreground shadow-xl backdrop:bg-black/50"
        onClick={(e) => {
          if (e.target === dialogRef.current) dialogRef.current?.close();
        }}
      >
        {elegida && (
          <div className="space-y-4 p-6">
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-1">
                <h2 className="text-lg font-semibold text-balance">{elegida.resumen}</h2>
                <p className="text-sm text-foreground/60">
                  {elegida.accion} · {elegida.tipo}
                </p>
                <p className="text-xs text-foreground/50">
                  {elegida.cuando} · {elegida.usuario}
                </p>
              </div>
              <button
                type="button"
                onClick={() => dialogRef.current?.close()}
                aria-label="Cerrar"
                className="rounded-lg p-1 text-foreground/40 transition-colors hover:bg-foreground/5 hover:text-foreground"
              >
                <X size={18} />
              </button>
            </div>

            {elegida.cambios && elegida.cambios.length > 0 ? (
              <div className="max-h-[50vh] overflow-auto rounded-lg border border-foreground/10">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-foreground/10 bg-foreground/[0.03] text-left text-foreground/60">
                      <th className="px-3 py-2 font-medium">Campo</th>
                      <th className="px-3 py-2 font-medium">Antes</th>
                      <th className="px-3 py-2 font-medium">Después</th>
                    </tr>
                  </thead>
                  <tbody>
                    {elegida.cambios.map((c) => (
                      <tr key={c.campo} className="border-b border-foreground/5 last:border-0">
                        <td className="px-3 py-2 align-top font-medium">{c.campo}</td>
                        {/* `whitespace-pre-line`: las líneas de un remito o de una producción vienen
                            todas en un campo, una por renglón. */}
                        <td className="px-3 py-2 align-top whitespace-pre-line text-foreground/50">
                          {c.antes ?? "—"}
                        </td>
                        <td className="px-3 py-2 align-top whitespace-pre-line">{c.despues ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="rounded-lg border border-foreground/10 bg-foreground/[0.02] px-3 py-4 text-sm text-foreground/50">
                De esta operación no quedó guardado el detalle campo por campo. Se guarda desde que
                la app lo registra; lo cargado antes figura solamente con su resumen.
              </p>
            )}

            {elegida.destino && (
              <Link
                href={elegida.destino}
                className="inline-flex items-center gap-1 text-sm underline underline-offset-2"
              >
                Ver el registro
                <ChevronRight size={14} />
              </Link>
            )}
          </div>
        )}
      </dialog>
    </>
  );
}
