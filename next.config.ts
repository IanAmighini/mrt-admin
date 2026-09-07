import type { NextConfig } from "next";

/**
 * Motores de base de datos que Prisma empaqueta siempre, para todas las bases que soporta. El
 * proyecto usa PostgreSQL y nada más, así que los otros cuatro son 45 MB muertos **por función**;
 * con 34 rutas eso son ~1,5 GB por deployment, y Vercel cobra el Function Storage sumando todos los
 * deployments guardados.
 *
 * Se excluyen del trace y no del disco: en desarrollo Prisma sigue teniendo todo. Es seguro porque
 * Prisma carga el motor que corresponde al `provider` del schema, y ese —postgresql— no se toca.
 */
const MOTORES_SIN_USO = ["mysql", "sqlite", "sqlserver", "cockroachdb"].flatMap((base) => [
  `./node_modules/@prisma/client/runtime/query_engine_bg.${base}.wasm-base64.js`,
  `./node_modules/@prisma/client/runtime/query_engine_bg.${base}.wasm-base64.mjs`,
  `./node_modules/@prisma/client/runtime/query_compiler_bg.${base}.wasm-base64.js`,
  `./node_modules/@prisma/client/runtime/query_compiler_bg.${base}.wasm-base64.mjs`,
]);

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
