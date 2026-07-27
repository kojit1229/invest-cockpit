# 投資航路

K専用の投資意思決定コックピット。モバイル向けWebアプリ(PWA化は後続増分)。決算ナビ・相場帳・需給ナビ・invest-agentの4アプリに散らばった銘柄状態を1つにまとめ、「今日、何を判断すべきか」から投資フローを始められるようにする薄い実行面。詳細な設計判断は [docs/design.md](docs/design.md) を参照。

## 開発コマンド

```bash
npm install       # 依存関係のインストール
npm run dev        # 開発サーバ起動
npm run typecheck  # 型チェック(tsc --noEmit)
npm run build      # 本番ビルド(dist/を生成)
npm run gate       # typecheck + build(CI相当のゲート)
```

## デプロイ

`main`ブランチへのpushで`.github/workflows/deploy.yml`が自動的にビルドし、GitHub Pagesへデプロイする(`workflow_dispatch`での手動実行も可)。
