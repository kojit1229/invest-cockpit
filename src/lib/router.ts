// ハッシュルーティング(増分2、増分4で#/settingsを追加、増分9で#/reviewを追加)。
// ライブラリは使わず自前実装。
// ルート一覧: "#/" = 今日画面 / "#/ticker/<id>" = 銘柄カルテ / "#/import" = インポート画面 /
// "#/settings" = 設定画面(private repo同期のトークン設定) / "#/review" = 週次レビュー画面
// 未知のハッシュは今日画面にフォールバックする(アプリを落とさない)。

import { useEffect, useState } from "preact/hooks";

export type Route =
  | { name: "today" }
  | { name: "ticker"; id: string }
  | { name: "import" }
  | { name: "settings" }
  | { name: "review" };

export function parseHash(hash: string): Route {
  const path = hash.replace(/^#\/?/, "");
  if (path === "" || path === "/") return { name: "today" };
  if (path === "import") return { name: "import" };
  if (path === "settings") return { name: "settings" };
  if (path === "review") return { name: "review" };
  const m = /^ticker\/(.+)$/.exec(path);
  if (m) return { name: "ticker", id: decodeURIComponent(m[1]) };
  return { name: "today" };
}

/** 現在のハッシュルートを返し、hashchangeで再レンダーする。 */
export function useHashRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseHash(window.location.hash));

  useEffect(() => {
    function onHashChange() {
      setRoute(parseHash(window.location.hash));
    }
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  return route;
}

export function tickerHref(id: string): string {
  return `#/ticker/${encodeURIComponent(id)}`;
}
