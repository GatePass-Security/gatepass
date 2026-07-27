import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  // Workspace packages ship TypeScript source with NodeNext-style ".js" specifiers; Next has to
  // compile them and resolve those specifiers back to ".ts" itself.
  transpilePackages: ["@gatepass/findings", "@gatepass/shared", "@gatepass/compliance", "@gatepass/engine"],
  outputFileTracingRoot: path.join(import.meta.dirname, "../../"),
  // Those packages target NodeNext, so `export * from "./x.js"` actually means `./x.ts`.
  // Bundler-mode resolution doesn't infer that on its own.
  webpack: (config) => {
    config.resolve.extensionAlias = {
      ...(config.resolve.extensionAlias ?? {}),
      ".js": [".ts", ".tsx", ".js"],
    };
    return config;
  },
  turbopack: {
    resolveExtensions: [".ts", ".tsx", ".mts", ".js", ".jsx", ".mjs", ".json"],
  },
};

export default nextConfig;
