import js from "@eslint/js";
import tseslint from "typescript-eslint";

/**
 * Flat ESLint config (T100). Lenient by design — catches genuinely broken code while leaving
 * stylistic choices to Prettier. Test fixtures and corpus trees are intentionally excluded
 * (they contain deliberately vulnerable code).
 */
export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/.next/**",
      "**/node_modules/**",
      // Agent worktrees are whole second copies of this repo living inside it. Linting them
      // reports the same file twice — once as it is, once as it was on another branch — so a
      // clean tree can fail `pnpm lint` because of code nobody is editing here.
      ".claude/**",
      "ide/**/extension.ts",
      "**/*.d.ts",
      "corpus/cases/**",
      "corpus/eval-repos/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      "no-undef": "off", // TypeScript already resolves globals/identifiers
      "no-empty": "warn",
      "no-control-regex": "off",
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-non-null-assertion": "off",
    },
  },
);
