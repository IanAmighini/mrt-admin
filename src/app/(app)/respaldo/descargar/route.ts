import { getCurrentUser } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";
import { armarRespaldo, comprimirRespaldo } from "@/lib/respaldo";
import { logAudit } from "@/lib/audit";
import { hoyEnInput } from "@/lib/period";

/**
 * El respaldo de la base entera, para bajar y guardar. Sólo Admin: el archivo tiene todo, también
 * las contraseñas (cifradas) de los usuarios. El chequeo se repite acá porque un Route Handler no
 * pasa por el layout.
 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return new Response("No autorizado", { status: 401 });
  if (user.role !== "ADMIN") return new Response("Sólo un administrador puede bajar el respaldo", { status: 403 });

  const respaldo = await armarRespaldo(prisma);
  const archivo = comprimirRespaldo(respaldo);
  const filas = Object.values(respaldo.tablas).reduce((acc, t) => acc + t.length, 0);
  // Queda en Actividad: es lo que muestra la pantalla como "último respaldo".
  await logAudit(prisma, {
    userId: user.id,
    action: "CREATE",
    entityType: "Respaldo",
    summary: `Respaldo descargado — ${filas} filas, ${Math.ceil(archivo.length / 1024)} KB`,
  });

  return new Response(new Uint8Array(archivo), {
    headers: {
      "Content-Type": "application/gzip",
      "Content-Disposition": `attachment; filename="respaldo-mrt-${hoyEnInput()}.json.gz"`,
    },
  });
}
