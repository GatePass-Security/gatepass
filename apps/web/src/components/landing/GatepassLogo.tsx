import React from "react";

interface GatepassLogoProps extends React.ImgHTMLAttributes<HTMLImageElement> {
  size?: number | string;
}

/**
 * Gatepass Brand Logo Mark using the generated image asset.
 */
export function GatepassLogo({ size = 60, className, style, ...props }: GatepassLogoProps) {
  return (
    <img
      src="/landing/gatepass-logo.png"
      alt="Gatepass Logo"
      width={size}
      height={size}
      className={className}
      style={{
        width: size,
        height: size,
        objectFit: "contain",
        display: "inline-block",
        verticalAlign: "middle",
        ...style,
      }}
      {...props}
    />
  );
}
