import * as React from "react";
import { cn } from "@/lib/utils";

function hexToRgba(hex: string, alpha = 1): string {
  let hexValue = hex.replace("#", "");

  if (hexValue.length === 3) {
    hexValue = hexValue
      .split("")
      .map((char) => char + char)
      .join("");
  }

  const r = parseInt(hexValue.substring(0, 2), 16);
  const g = parseInt(hexValue.substring(2, 4), 16);
  const b = parseInt(hexValue.substring(4, 6), 16);

  if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) {
    return "rgba(0, 0, 0, 1)";
  }

  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

type GlowingButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  glowColor?: string;
};

export function GlowingButton({
  children,
  className,
  glowColor = "#a75c3f",
  style,
  ...props
}: GlowingButtonProps) {
  const glowColorRgba = hexToRgba(glowColor);
  const glowColorVia = hexToRgba(glowColor, 0.08);
  const glowColorTo = hexToRgba(glowColor, 0.22);

  return (
    <button
      style={
        {
          "--glow-color": glowColorRgba,
          "--glow-color-via": glowColorVia,
          "--glow-color-to": glowColorTo,
          ...style,
        } as React.CSSProperties
      }
      className={cn("glowing-button", className)}
      {...props}
    >
      <span className="glowing-button-content">{children}</span>
    </button>
  );
}

export { GlowingButton as Component };
