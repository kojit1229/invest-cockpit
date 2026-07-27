import { useState } from "preact/hooks";
import { ImportCandidate, ImportSourceResult, readImportSources } from "../lib/external";

interface Props {
  existingIds: Set<string>;
  onImport: (candidates: ImportCandidate[]) => { imported: number; skipped: number };
}

function candidateKey(c: ImportCandidate): string {
  return `${c.source}:${c.code}`;
}

/**
 * インポート画面(`#/import`)。需給ナビ・決算ナビのlocalStorageから銘柄候補を読み、
 * 選択して一括でcandidate状態として追加する。一回限りの読み込みで、自動同期ではない。
 */
export function ImportPage({ existingIds, onImport }: Props) {
  const [sources] = useState<ImportSourceResult[]>(() => readImportSources());
  const [selected, setSelected] = useState<Set<string>>(() => {
    const s = new Set<string>();
    for (const src of sources) {
      for (const c of src.candidates) s.add(candidateKey(c));
    }
    return s;
  });
  const [result, setResult] = useState<{ imported: number; skipped: number } | null>(null);

  function toggle(k: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(k)) {
        next.delete(k);
      } else {
        next.add(k);
      }
      return next;
    });
  }

  function handleImport() {
    const chosen: ImportCandidate[] = [];
    for (const src of sources) {
      for (const c of src.candidates) {
        if (selected.has(candidateKey(c))) chosen.push(c);
      }
    }
    setResult(onImport(chosen));
  }

  const totalCandidates = sources.reduce((n, s) => n + s.candidates.length, 0);

  return (
    <section class="import-page">
      <a class="back-link" href="#/">
        ← 今日画面へ戻る
      </a>
      <h1>ウォッチリストをインポート</h1>
      <p class="import-page__hint">
        需給ナビ・決算ナビにこのブラウザで登録済みの銘柄を一回限り読み込みます(自動同期ではありません。読み込むだけで旧アプリ側は変更しません)。
      </p>
      {result && (
        <p class="import-page__result">
          インポートしました: {result.imported}件追加 / {result.skipped}件は既存のためスキップ
        </p>
      )}
      {sources.map((src) => (
        <div class="import-page__source" key={src.source}>
          <h2>{src.label}</h2>
          {src.error ? (
            <p class="empty-state">読み込めませんでした(データ形式が想定と異なります)</p>
          ) : src.candidates.length === 0 ? (
            <p class="empty-state">見つかりません</p>
          ) : (
            <ul class="import-list">
              {src.candidates.map((c) => {
                const k = candidateKey(c);
                const already = existingIds.has(c.id);
                return (
                  <li class="import-list__item" key={k}>
                    <label>
                      <input type="checkbox" checked={selected.has(k)} onChange={() => toggle(k)} />
                      <span>{c.id}</span>
                      {already && <span class="import-list__badge">登録済み</span>}
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      ))}
      {totalCandidates > 0 && (
        <button type="button" onClick={handleImport}>
          インポート
        </button>
      )}
    </section>
  );
}
