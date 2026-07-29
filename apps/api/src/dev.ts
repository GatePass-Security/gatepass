/**
 * Local development entry point — `pnpm --filter @gatepass/api dev`.
 *
 * The only thing it does beyond `index.ts` is turn on the development sign-in, so a machine
 * with no GitHub OAuth app can still sign in and use the dashboard. It exists as a separate
 * entry rather than a `GATEPASS_DEV_AUTH=1 tsx …` script because that form is shell-specific
 * and this repo is developed on both Windows and macOS.
 *
 * Production runs `start` (see render.yaml), which goes through `index.ts` and never sets the
 * flag. And even if it somehow did, `devAuthEnabled()` refuses when `NODE_ENV=production`.
 *
 * Both are `??=`, so an explicit environment value always wins — including
 * `GATEPASS_DEV_AUTH=0` to run the dev server with only the real sign-in available.
 */
process.env.NODE_ENV ??= "development";
process.env.GATEPASS_DEV_AUTH ??= "1";

const { startServer } = await import("./index.js");
await startServer();
