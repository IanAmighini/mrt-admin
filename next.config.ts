import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /** exceljs y nodemailer son CommonJS y resuelven dependencias con `require` dinámico: si el
   * bundler los intenta empaquetar compilan bien pero rompen en runtime, así que se dejan
   * externos. */
  serverExternalPackages: ["exceljs", "nodemailer"],
};

export default nextConfig;
