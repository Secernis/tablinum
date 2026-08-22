import { defineConfig } from "vite";

// Second dev server: serves design/ — brand portal, mocks, master SVGs and
// generated assets. Deliberately its own server rather than a sub-path of the
// app: the brand system is an authoring environment, not part of the product,
// and must never slip into the app build.
//
// @ts-expect-error process is a nodejs global
const port = Number(process.env.BRAND_PORT) || 1425;

export default defineConfig({
  root: "design",

  // Multi-page, not SPA. Without this Vite silently serves index.html with
  // status 200 for every unknown HTML address — a deleted page then looks like
  // it still exists, and a typo in a link never surfaces. With "mpa" you get a
  // proper 404.
  appType: "mpa",
  // No build target: this server exists for `dev` only.
  server: {
    port,
    strictPort: true,
    // generated-assets/ sits under root and is therefore served directly.
    watch: { ignored: ["**/node_modules/**", "**/__pycache__/**"] },
  },
});
