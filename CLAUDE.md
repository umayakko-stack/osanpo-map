# おさんぽマップ 開発メモ

GPSで散歩ルートを記録するアプリ。Web版（GitHub Pages）とAndroidアプリ版（Capacitor）の2形態。

## 構成

- `docs/` — アプリ本体（素のHTML/JS/CSS、ビルド不要）。GitHub Pagesがこのフォルダを配信
  - `app.js` — 全ロジック。`IS_NATIVE`（`window.__CapCore.isNativePlatform()`）でアプリ版/Web版を分岐
  - `capacitor-bundle.js` — esbuildで@capacitor/coreをバンドルしたもの（生成物）。ソースは `native-entry.js`
  - `leaflet.js` / `leaflet.css` — ローカル同梱（CDN不使用）
- `android/` — Capacitor Androidプロジェクト（コミット済み）
- データはすべてlocalStorage（キー: osanpo_walks / osanpo_conditions / osanpo_weights / osanpo_settings）。サーバーなし

## 開発ルール

- **JS/CSSを変更したら `docs/index.html` の `?v=N` を必ず+1する**（キャッシュバスト）
- `native-entry.js` を変更したら再バンドル:
  `npx esbuild native-entry.js --bundle --format=iife --minify --outfile=docs/capacitor-bundle.js`
- Web版の動作確認: `python -m http.server 8090 --directory docs` → `http://localhost:8090/?demo`（GPSなし擬似散歩）
- デモの移動速度は秒速4m以下にすること（app.jsが4m/s超をGPSノイズとして捨てるため）

## デプロイ

- **Web版**: mainにpushするだけ（Pagesが1-2分で自動反映）
- **Androidアプリ版**: APKビルドは自宅Windows PCのローカル環境が必要
  （`C:\Users\Owner\android-dev` のJDK21+SDK35、`JAVA_HOME`設定 → `npx cap sync android && cd android && ./gradlew assembleDebug`）
  クラウド環境ではビルドせず、docs/の変更のみ行うこと。APKはGitHub Releasesで配布（現行v1.0.1）

## 注意（過去のバグから）

- ネイティブ注入の`native-bridge.js`には`registerPlugin`が**無い**。@capacitor/coreは必ずバンドル経由で使う（v1.0.0はこれで全JS停止した）
- 位置情報フィルタ: 精度>50m除外・3m未満無視・速度4m/s超はノイズ（60秒超の空白後なら距離に入れず再開）。画面オフ空白は直線補完
