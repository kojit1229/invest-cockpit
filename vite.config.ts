import { defineConfig } from "vite";
import preact from "@preact/preset-vite";

// GitHub Pages配信前提: リポジトリ名 invest-cockpit が公開パスになる。
// 変更する場合は .github/workflows/deploy.yml のPages設定と合わせて見直すこと。
export default defineConfig({
  base: "/invest-cockpit/",
  plugins: [preact()],
});
