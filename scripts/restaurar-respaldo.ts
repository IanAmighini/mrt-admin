/**
 * Restaurar un respaldo bajado desde Administración → Respaldo.
 *
 *   npm run restaurar-respaldo -- respaldo-mrt-2026-10-07.json.gz            (sólo muestra qué tiene)
 *   npm run restaurar-respaldo -- respaldo-mrt-2026-10-07.json.gz --confirmar (borra todo y lo carga)
 *
 * Restaurar **reemplaza todo** lo que hay en la base por lo del archivo: lo que se cargó después de
 * esa fecha se pierde. Por eso sin `--confirmar` no toca nada. Corre contra la base de DATABASE_URL.
 *
 * Si se perdió la base entera y hay que restaurar en una vacía, primero hay que crearle las tablas.
 * Las migraciones no se pueden repetir desde cero (una de septiembre no corre sobre una base vacía),
 * así que la estructura se crea desde el esquema y se marcan las migraciones como hechas:
 *
 *   npx prisma db push --skip-generate
 *   npx prisma migrate resolve --applied <cada carpeta de prisma/migrations, en orden>
 *
 * y recién después se restaura. Así se probó el 2026-10-07: 33 tablas, idénticas al archivo.
 */
import { readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { leerRespaldo, restaurarRespaldo, resumenDelRespaldo } from "../src/lib/respaldo";

async function main() {
  const [ruta, ...flags] = process.argv.slice(2);
  if (!ruta) {
    console.error("Falta el archivo: npm run restaurar-respaldo -- respaldo.json.gz [--confirmar]");
    process.exit(1);
  }
  const respaldo = leerRespaldo(readFileSync(ruta));
  const db = new PrismaClient();
  try {
    const actual = await db.$queryRawUnsafe<{ migration_name: string }[]>(
      `SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name DESC LIMIT 1`
    );
    const migracionActual = actual[0]?.migration_name ?? null;

    console.log(`Respaldo del ${new Date(respaldo.generadoEl).toLocaleString("es-AR")}`);
    console.log(`Estructura del respaldo: ${respaldo.migracion}`);
    console.log(`Estructura de la base:   ${migracionActual}`);
    for (const { tabla, filas } of resumenDelRespaldo(respaldo)) if (filas > 0) console.log(`  ${tabla}: ${filas}`);

    if (respaldo.migracion !== migracionActual && !flags.includes("--forzar")) {
      console.error(
        "\nLa base cambió de estructura desde que se hizo el respaldo. No se restaura: pedile a quien mantiene la app que lo adapte."
      );
      process.exit(1);
    }
    if (!flags.includes("--confirmar")) {
      console.log("\nNo se tocó nada. Para reemplazar la base por este respaldo, agregá --confirmar.");
      return;
    }
    await restaurarRespaldo(db, respaldo);
    console.log("\nListo: la base quedó como en el respaldo.");
  } finally {
    await db.$disconnect();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
