// SPDX-License-Identifier: AGPL-3.0-or-later
import type { MetadataRoute } from "next";

/** Installable web app (scanner on the staff's phone). The service worker arrives in Phase 4b. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "PasaLista",
    short_name: "PasaLista",
    start_url: "/es-MX/dashboard",
    scope: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#171717",
    icons: [
      { src: "/icon/192", sizes: "192x192", type: "image/png" },
      { src: "/icon/512", sizes: "512x512", type: "image/png" },
      { src: "/icon/512", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
