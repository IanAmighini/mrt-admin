import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Envasadora — Sistema de Gestión",
    short_name: "Envasadora",
    description: "Cuentas corrientes, stock, producción y pallets",
    start_url: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#e9d200",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  };
}
