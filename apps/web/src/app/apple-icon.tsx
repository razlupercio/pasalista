// SPDX-License-Identifier: AGPL-3.0-or-later
import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
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
        fontSize: 108,
        fontWeight: 700,
      }}
    >
      ✓
    </div>,
    size,
  );
}
