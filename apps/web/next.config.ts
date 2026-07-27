import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  /*
   * Workspace packages ship as TypeScript source, so Next has to compile them.
   * `@gatepass/compliance` and `@gatepass/engine` were missing here while
   * `compliance/ComplianceDashboard.tsx` imported both — `next build` failed on
   * that route before this was added.
   */
  transpilePackages: ["@gatepass/findings", "@gatepass/shared", "@gatepass/compliance", "@gatepass/engine"],
  outputFileTracingRoot: path.join(import.meta.dirname, "../../"),

  /*
   * Those packages use TypeScript's NodeNext convention, where a `.ts` file
   * imports its sibling as `./thing.js`. Webpack resolves that literally and
   * 404s, so the extension has to be aliased back. Turbopack needs the same
   * mapping expressed its own way.
   */
  webpack(config) {
    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      ".js": [".ts", ".tsx", ".js"],
      ".mjs": [".mts", ".mjs"],
    };
    return config;
  },

  turbopack: {
    resolveAlias: {},
    resolveExtensions: [".tsx", ".ts", ".jsx", ".js", ".mjs", ".json"],
  },
};

export default nextConfig;
