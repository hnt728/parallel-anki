# Parallel Anki

今日の問題をまとめて解く、記述式の分散学習アプリです。コレクションに問題と正解を登録し、Web か A4 の問題用紙で解答します。採点後は、間違えた問題だけをすべて正解するまで解き直せます。

- **記述式の採点** — 別解を複数登録できます。全角と半角、英字の大文字と小文字、連続する空白を正規化したうえで照合します。採点結果で自分の解答と正解を比較できます。
- **紙の読み取り** — 各ページの四隅にある QR マーカーで、ページ番号、用紙の向きと遠近を補正します。解答欄だけを Workers AI に送り、画面で画像と文字を比較・修正してから採点します。OCR が利用できない場合は補正画像を見ながら入力できます。
- **FSRS** — 初回の正誤を Good / Again として次回日を計算します。同じ日の解き直しは忘却度の計算に重ねて加えません。端末のタイムゾーンで復習日を判定します。
- **同期** — コレクション、問題、復習の周回、確定した採点結果は D1 に保存されます。入力途中の文字と読み込み済みページはそのブラウザーのタブに保持します。

## ローカルで起動する

Node.js 22.12 以降と npm が必要です。

```sh
npm ci
npx cf cli search 'apply local D1 database migrations'
npx cf d1 migrations apply 00000000-0000-4000-8000-000000000001 --mode development --local --dry-run
npx cf d1 migrations apply 00000000-0000-4000-8000-000000000001 --mode development --local
npx cf cli search 'cf dev'
npm run dev
npm test
```

開発モードではローカル D1 を使います。localhost のみ Access を省略でき、紙の解答は補正画像を見ながら入力できます。

## Cloudflare に自分用のアプリを公開する

1. `npx cf auth login` でログインし、Worker のカスタムドメインに使うホスト名を決めます。
2. D1 を作成し、返された UUID を控えます。
3. [Cloudflare Access](https://developers.cloudflare.com/workers/configuration/cloudflare-access/) に同じホスト名の Self-hosted アプリを作成します。Include に自分のメールアドレスだけを含む Allow ポリシーを設定し、アプリケーションの AUD を控えます。自分用の再利用ポリシーがある場合は再利用できます。
4. 次の環境変数をシェルに設定します。

| 環境変数 | 値 |
| --- | --- |
| `CLOUDFLARE_ACCOUNT_ID` | デプロイ先アカウント ID |
| `PARALLEL_ANKI_D1_ID` | D1 の UUID |
| `PARALLEL_ANKI_DOMAIN` | Worker 用のカスタムホスト名 |
| `PARALLEL_ANKI_ACCESS_TEAM` | Access チームのドメイン（例 `example.cloudflareaccess.com`） |
| `PARALLEL_ANKI_ACCESS_AUD` | Access アプリの AUD |

```sh
npx cf cli search 'create D1 database'
npx cf d1 create --name parallel-anki --dry-run
npx cf d1 create --name parallel-anki

# D1 ID と Access の設定後に実行
npx cf cli search 'apply D1 migrations'
npx cf d1 migrations apply "$PARALLEL_ANKI_D1_ID" --dry-run
npx cf d1 migrations apply "$PARALLEL_ANKI_D1_ID"
npx cf cli search 'cf deploy'
npx cf deploy --dry-run
npx cf deploy
```

Worker は Access の署名と AUD を照合し、`workers.dev` とプレビュー URL を無効にします。1 デプロイにつき 1 つの学習データを保持する設計なので、利用者ごとに個別にデプロイしてください。D1 の単一ワークスペースの上限は約 1.85 MB です。手書きの読み取りには [Workers AI の Gemma 4](https://developers.cloudflare.com/workers-ai/models/gemma-4-26b-a4b-it/) を使用します。利用枠と料金は Cloudflare アカウントに適用されます。

## ライセンス

MIT
