# 工工四を撮ると鳴る

紙に書いた工工四（くんくんしー）をスマホで撮ると、三線の音で弾いてくれるWebアプリです。
読み取りも音づくりも端末の中だけで行い、写真はどこにも送りません。

- 公開先: https://yannsi.github.io/kunkunshi/
- 作品集: https://yannsi.github.io/

## 使い方

1. 「用紙を印刷する」で、四隅に黒い四角のある用紙（A4）を印刷する
2. 黒か青のペンで工工四を書く（1マス＝1拍、〇＝休み、空きマス＝前の音をのばす、縦に2つで半拍ずつ）
3. 四隅が写るように撮る → 読み取った字が並ぶ。違うマスはタップで直す
4. ▶で弾く（本調子・合＝ド）

## 仕組み

| 場所 | 中身 |
|---|---|
| `src/engine.js` | 用紙の形、写真から四隅の目印を探す、斜めを直してマスを切り出す、字を見分ける、音の並びにする |
| `src/sheet.js` | 用紙（SVG） |
| `src/app.html` `src/youshi.html` `src/sw.js` | 画面・印刷ページ・オフライン保存 |
| `model/model.json` | 字を見分ける小さなニューラルネットの重み（約9万個、8ビット） |
| `tools/build.py` | `src/` と `model/` から公開用の `index.html` `youshi.html` `sw.js` を組み立てる |
| `tools/train/` | 学習用の字を合成し（`kks_data.py` `gen.py`）、学習（`train.py`）して書き出す（`export.py`） |
| `tools/make_photo.py` `tools/test_read.js` | 手書き風の用紙を斜めに撮った想定の画像を作り、読み取りを確かめる |

`index.html` `youshi.html` `sw.js` は組み立てた結果なので直接編集しません。

## 学習に使ったもの

- 字の筆順データ: [KanjiVG](https://kanjivg.tagaini.net/)（© Ulrich Apel, CC BY-SA 3.0）
- 手書き風の字形: Google Fonts の日本語フォント（SIL Open Font License）
- 三線の音は、声のQR（yannsi/koe-qr）と同じカープラス・ストロング法で合成しています

字の見分け方（`model/model.json`）は KanjiVG のデータから作ったため、CC BY-SA 3.0 で公開します。
