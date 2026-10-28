# invoice-cli

JSONから[Code for Funの帳票作成ツール](https://codeforfun.jp/tools/invoice/)のPDFを作成するCLIです。Node.js 22以上が必要です。ブラウザやサイトへの登録は不要です。

`generate` は請求書の内容と印鑑画像を **codeforfun.jpへ送信** します。サイトのフォーム仕様に依存する非公式ツールです。通常の請求書、見積書、納品書、領収書、インボイス制度対応版を利用できます。

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

`init` と `generate` は既存ファイルを上書きしません。上書きする場合は `--force` を付けてください。入力JSON・印鑑画像と同じファイルへの出力は、`--force` を付けても拒否します。保存先ディレクトリは事前に作成してください。

```sh
invoice-cli init --force
invoice-cli generate invoice.json -o invoice.pdf --force
invoice-cli --help
invoice-cli --version
```

成功時の終了コードは0、失敗時は1です。`generate` と `init` は保存先の絶対パスを標準出力へ、エラーは標準エラーへ出力します。`validate` はサイトへ送信せず、入力・印鑑ファイルと計算結果を確認します。

## 帳票の種類を選ぶ

`init --type` で帳票ごとの入力例を作成します。生成・検証時はJSONの `type` から帳票を選びます。`type` を省略した既存JSONは、従来どおり通常の請求書として扱います。

| `type` | 帳票 | 初期化されるファイル |
| --- | --- | --- |
| `invoice` | [通常の請求書](https://codeforfun.jp/tools/invoice/) | `invoice.json` |
| `estimate` | [見積書](https://codeforfun.jp/tools/estimate/) | `estimate.json` |
| `delivery` | [納品書](https://codeforfun.jp/tools/delivery/) | `delivery.json` |
| `receipt` | [領収書](https://codeforfun.jp/tools/receipt/) | `receipt.json` |
| `invoice2` | [インボイス制度対応版](https://codeforfun.jp/tools/invoice2/) | `invoice2.json` |

```sh
invoice-cli init --type estimate
# estimate.jsonを編集
invoice-cli validate estimate.json
invoice-cli generate estimate.json -o estimate.pdf

invoice-cli init --type delivery
invoice-cli init --type receipt
invoice-cli init --type invoice2
```

## 通常の請求書の入力項目

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

住所などの改行は `\n` で指定します。`<`・`>`・`&` などは全帳票で文字として表示し、HTMLとしては扱いません。印鑑を付ける場合は `"stamp": "./stamp.png"` を追加してください。未知のキー、`null`、数値の文字列指定はエラーになります。

単価×数量の合計を小計とし、小計に税率を掛けて1円未満を切り捨てます。合計は「小計＋消費税−源泉徴収額」です。源泉徴収額は自動計算しません。支払額を超える指定も受け付け、その場合の合計は負の金額になります。数値と計算結果はJavaScriptの安全な整数範囲内に制限します。

## 見積書・納品書の入力項目

`type` は `estimate` または `delivery` とし、番号・日付には `documentNumber`・`documentDate` を使います。請求書の `invoiceNumber`・`invoiceDate` は指定できません。

```json
{
  "type": "estimate",
  "to": "株式会社サンプル 御中",
  "fromAddress": "東京都新宿区（架空住所）\n山田 太郎",
  "documentNumber": "EST-001",
  "documentDate": "2026-10-28",
  "subject": "開発費",
  "items": [{ "name": "開発作業", "unitPrice": 100000, "quantity": 1 }],
  "taxEnabled": true,
  "note": "有効期限：2026年11月30日\n納期：別途相談\n支払条件：納品月末締め翌月末払い"
}
```

必須項目は `to`・`fromAddress`・1〜10件の `items` です。任意項目は `toAddress`・`documentNumber`・`documentDate`・`subject`・`taxEnabled`・`note` です。見積書の有効期限や支払条件は `note` に記載します。

サイトに合わせて消費税は10%固定、`taxEnabled` の既定値は `true` です。`false` なら加算しません。印鑑・振込先・支払期限日・源泉徴収額・税率指定には対応しておらず、指定するとエラーになります。

## 領収書は金額と内訳を直接指定する

領収書には明細を指定せず、`total` に領収金額を直接入力します。内訳の自動計算は行いません。

```json
{
  "type": "receipt",
  "to": "株式会社サンプル 御中",
  "fromAddress": "東京都新宿区（架空住所）\n山田 太郎",
  "documentNumber": "REC-001",
  "documentDate": "2026-10-28",
  "total": 110000,
  "subject": "開発費として",
  "details": "銀行振込",
  "netAmount": 100000,
  "taxDescription": "10%",
  "layout": "portrait"
}
```

| キー | 内容・条件 | 省略時 |
| --- | --- | --- |
| `to`, `fromAddress` | 宛先・送付者情報。空でない文字列 | 必須 |
| `total` | 領収金額。0以上の安全な整数 | 必須 |
| `toAddress` | 宛先住所 | 空欄 |
| `documentNumber` | 領収書番号 | 空欄 |
| `documentDate` | 発行日。実在する `YYYY-MM-DD` | 空欄 |
| `subject` | 但し書き | 空欄 |
| `details` | 内訳の説明 | 空欄 |
| `netAmount` | 税抜金額。0以上の安全な整数 | 空欄 |
| `taxDescription` | 消費税等の表示文字列。例：`10%`、`税込` | 空欄 |
| `layout` | `portrait`（タテ型）または `landscape`（ヨコ型） | `portrait` |

領収書では `items`・`note`・`stamp`・`bankDetails` など、表にないキーは指定できません。

## インボイス制度対応版は明細ごとに税率を選ぶ

`type` を `invoice2` にすると、税率別の対象額・消費税と登録番号を表示するサイトの書式を使います。登録番号の存在や登録状況の照会は行いません。初期化される登録番号は架空の例なので、編集してから使用してください。

```json
{
  "type": "invoice2",
  "to": "株式会社サンプル 御中",
  "fromAddress": "東京都新宿区（架空住所）\n山田 太郎",
  "registrationNumber": "T0000000000000",
  "invoiceNumber": "INV-001",
  "invoiceDate": "2026-10-28",
  "dueDate": "2026-11-30",
  "subject": "開発費ほか",
  "items": [
    { "name": "開発作業", "unitPrice": 100000, "quantity": 1, "taxRate": 10, "withholding": true },
    { "name": "軽減対象品（架空）", "unitPrice": 1000, "quantity": 2, "taxRate": 8 },
    { "name": "対象外（架空）", "unitPrice": 500, "quantity": 1, "taxRate": "exempt" }
  ],
  "bankDetails": "○○銀行 ○○支店 普通 1234567",
  "note": ""
}
```

通常の請求書の必須項目に加え、空でない文字列の `registrationNumber` が必要です。任意の文字列項目は通常の請求書と共通で、印鑑画像も利用できます。

| 明細の追加キー | 指定値 | 省略時 |
| --- | --- | --- |
| `items[].taxRate` | `10`・`8`・`"exempt"`（対象外） | `10` |
| `items[].withholding` | 源泉徴収対象かどうかの真偽値 | `false` |

10%・8%それぞれの対象額を合算してから消費税を切り捨てます。8%の品名にはサイトと同じ軽減税率の印 `※` を付けます。源泉徴収額は対象明細の税抜金額を合算し、サイトの式で計算します。100万円以下は10.21%、超過部分は20.42%とし、1円未満を切り捨てます。上の例では小計102,500円、消費税10,160円、源泉徴収額10,210円、合計102,450円です。

帳票全体の `taxRate`・`taxEnabled`・`withholdingTax` は指定できません。

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
