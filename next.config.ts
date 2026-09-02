import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /** exceljs es CommonJS y resuelve algunas dependencias con `require` dinámico: si el bundler
   * lo intenta empaquetar rompe en runtime, así que se deja externo. */
  serverExternalPackages: ["exceljs"],
};

export default nextConfig;
