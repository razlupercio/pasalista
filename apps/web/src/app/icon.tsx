// SPDX-License-Identifier: AGPL-3.0-or-later
import { ImageResponse } from "next/og";

export function generateImageMetadata() {
  return [192, 512].map((size) => ({
    id: String(size),
    size: { width: size, height: size },
    contentType: "image/png",
  }));
}

/** App icon: a check mark on dark, generated at build time (no binary assets in the repo). */
export default async function Icon({ id }: { id: Promise<string> }) {
  const size = Number(await id);
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#171717",
        color: "#ffffff",
        fontSize: size * 0.6,
        fontWeight: 700,
      }}
    >
      ✓
    </div>,
    { width: size, height: size },
  );
}
