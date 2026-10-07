import { Download } from "lucide-react";
import { requireRole } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";
import { formatFecha } from "@/lib/period";
import { buttonClass } from "@/components/ui/Button";

export default async function RespaldoPage() {
  await requireRole(["ADMIN"]);
  const ultimo = await prisma.auditLog.findFirst({
    where: { entityType: "Respaldo" },
    orderBy: { createdAt: "desc" },
    include: { user: { select: { name: true } } },
  });

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold mb-1">Respaldo</h1>
        <p className="text-sm text-foreground/60">
          Una copia de toda la base en un solo archivo, para guardarla donde quieras.
        </p>
      </div>

      <div className="space-y-4 rounded-xl border border-foreground/10 bg-background p-5 shadow-sm">
        <p className="text-sm">
          {ultimo
            ? `Último respaldo: ${formatFecha(ultimo.createdAt)}, por ${ultimo.user.name}.`
            : "Todavía no se bajó ningún respaldo."}
        </p>
        {/* Un link y no un formulario: el navegador baja el archivo y la pantalla se queda donde está. */}
        <a href="/respaldo/descargar" className={buttonClass("primario", "inline-flex w-fit items-center gap-1.5")}>
          <Download size={16} />
          Descargar respaldo
        </a>
        <ul className="list-disc space-y-1 pl-5 text-sm text-foreground/70">
          <li>
            Es un archivo <strong>.json.gz</strong>, chico: todo lo cargado hasta hoy, comprimido. Con
            doble click se descomprime y se puede abrir con cualquier editor de texto.
          </li>
          <li>Sirve para volver la base exactamente a como estaba el día que se bajó.</li>
          <li>
            Tiene todo, también los usuarios: guardalo en un lugar privado, no en una carpeta
            compartida.
          </li>
          <li>Bajalo cuando quieras: una vez por mes, al cerrar un trimestre o antes de un cambio grande.</li>
        </ul>
      </div>
    </div>
  );
}
