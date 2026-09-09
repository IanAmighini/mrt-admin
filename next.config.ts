import type { NextConfig } from "next";

/**
 * Motores de base de datos que Prisma empaqueta en cada función y que este proyecto no ejecuta
 * nunca. Son ~68 MB por función, y con 34 rutas eso multiplica por 34 — el Function Storage de
 * Vercel se cobra sumando todos los deployments guardados, así que unos pocos llenan la cuota.
 *
 * Se van dos cosas:
 *
 *   - Los motores de MySQL, SQLite, SQL Server y CockroachDB. El schema es PostgreSQL; Prisma los
 *     empaqueta igual porque el cliente soporta todas.
 *   - Los de PostgreSQL en formato **wasm**. Esos son para runtimes que no pueden ejecutar el
 *     binario nativo (edge, workers). Acá no hay ninguna ruta en edge, así que Prisma siempre usa
 *     el motor nativo `.node`, que NO se toca. Verificado escondiendo estos archivos y corriendo
 *     count, findMany, groupBy y una transacción contra la base real: anda todo.
 *
 * Es una exclusión del trace de salida, no del disco: en desarrollo Prisma sigue teniendo todo.
 */
const MOTORES_SIN_USO = ["mysql", "sqlite", "sqlserver", "cockroachdb", "postgresql"].flatMap(
  (base) => [
    `./node_modules/@prisma/client/runtime/query_engine_bg.${base}.wasm-base64.js`,
    `./node_modules/@prisma/client/runtime/query_engine_bg.${base}.wasm-base64.mjs`,
    `./node_modules/@prisma/client/runtime/query_compiler_bg.${base}.wasm-base64.js`,
    `./node_modules/@prisma/client/runtime/query_compiler_bg.${base}.wasm-base64.mjs`,
  ]
);

const nextConfig: NextConfig = {
  /** exceljs y nodemailer son CommonJS y resuelven dependencias con `require` dinámico: si el
   * bundler los intenta empaquetar compilan bien pero rompen en runtime, así que se dejan
   * externos. */
  serverExternalPackages: ["exceljs", "nodemailer"],
  outputFileTracingExcludes: {
    "**": MOTORES_SIN_USO,
  },
};

export default nextConfig;
