# invoice-cli

JSONから[かんたん請求書作成ツール](https://codeforfun.jp/tools/invoice/)の請求書PDFを作成するCLIです。Node.js 22以上が必要です。ブラウザやサイトへの登録は不要です。

`generate` は請求書の内容と印鑑画像を **codeforfun.jpへ送信** します。サイトのフォーム仕様に依存する非公式ツールです。適格請求書・見積書・納品書・領収書には対応していません。

## インストールしてPDFを作成する

このリポジトリで実行してください。

```sh
npm ci
npm run build
npm link
invoice-cli init
```

作成された `invoice.json` を編集し、入力と金額を確認してからPDFを生成します。

```sh
invoice-cli validate invoice.json
invoice-cli generate invoice.json -o invoice.pdf
```

標準入力も利用できます。印鑑を指定する場合、JSONファイルからの入力ではそのファイルの場所、標準入力では現在のディレクトリを基準に画像を探します。

```sh
cat invoice.json | invoice-cli generate - -o invoice.pdf
```

`init` と `generate` は既存ファイルを上書きしません。上書きする場合は `--force` を付けてください。保存先ディレクトリは事前に作成してください。

```sh
invoice-cli init --force
invoice-cli generate invoice.json -o invoice.pdf --force
invoice-cli --help
invoice-cli --version
```

成功時の終了コードは0、失敗時は1です。`generate` と `init` は保存先の絶対パスを標準出力へ、エラーは標準エラーへ出力します。`validate` はサイトへ送信せず、入力・印鑑ファイルと計算結果を確認します。

## JSONの入力項目

```json
{
  "to": "株式会社サンプル 御中",
  "toAddress": "東京都千代田区（架空住所）",
  "invoiceNumber": "INV-001",
  "invoiceDate": "2026-10-28",
  "dueDate": "2026-11-30",
  "fromAddress": "東京都新宿区（架空住所）\n山田 太郎",
  "subject": "開発費",
  "items": [{ "name": "開発作業", "unitPrice": 100000, "quantity": 1 }],
  "taxEnabled": true,
  "taxRate": 10,
  "withholdingTax": 0,
  "bankDetails": "○○銀行 ○○支店 普通 1234567",
  "note": ""
}
```

| キー | 内容・条件 | 省略時 |
| --- | --- | --- |
| `to` | 宛先。空でない文字列 | 必須 |
| `fromAddress` | 住所・氏名などの送付者情報。空でない文字列 | 必須 |
| `items` | 1〜10件の明細 | 必須 |
| `items[].name` | 品名。空でない文字列 | 必須 |
| `items[].unitPrice` | 単価。0以上の整数（円） | 必須 |
| `items[].quantity` | 数量。1以上の整数 | 必須 |
| `toAddress` | 宛先住所 | 空欄 |
| `invoiceNumber` | 請求書番号 | 空欄 |
| `invoiceDate` | 請求日。実在する `YYYY-MM-DD` | 空欄 |
| `dueDate` | 支払期限日。実在する `YYYY-MM-DD` | 空欄 |
| `subject` | 件名 | 空欄 |
| `taxEnabled` | 消費税を加算するか。真偽値 | `true` |
| `taxRate` | 消費税率。`8` または `10` | `10` |
| `withholdingTax` | 差し引く源泉徴収額。0以上の整数（円） | `0` |
| `bankDetails` | 振込先 | 空欄 |
| `note` | 備考 | 空欄 |
| `stamp` | 印鑑画像のパス。PNG/JPEG、1MiB以下 | 添付なし |

住所などの改行は `\n` で指定します。印鑑を付ける場合は `"stamp": "./stamp.png"` を追加してください。未知のキー、`null`、数値の文字列指定はエラーになります。

単価×数量の合計を小計とし、小計に税率を掛けて1円未満を切り捨てます。合計は「小計＋消費税−源泉徴収額」です。源泉徴収額は自動計算しません。支払額を超える指定も受け付け、その場合の合計は負の金額になります。数値と計算結果はJavaScriptの安全な整数範囲内に制限します。

## 通信や保存に失敗した場合

HTTPエラー、30秒のタイムアウト、PDF以外の応答はエラーになります。自動再送はしません。PDFヘッダーを確認してから保存し、通信失敗や保存失敗で既存のPDFを置き換えることはありません。一時ファイルは保存先と同じディレクトリに作成し、処理後に削除します。

サイト側の変更で動かなくなった場合は、このリポジトリのIssueへコマンドとエラー文を報告してください。請求内容や印鑑画像を公開する必要はありません。

## 開発とテスト

```sh
npm test
npm pack --dry-run
```

テストは入力検証、税計算、印鑑、ローカルHTTPサーバーへのmultipart送信、異常応答、ファイル保存、CLIの終了コードを確認します。通常のテストでは実サイトへ送信しません。

実サイトの確認は架空データで行ってください。送信処理は `src/site.ts` にまとめています。
