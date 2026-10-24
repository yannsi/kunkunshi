/* 工工四の用紙（A4縦）を SVG で描く。印刷用ページとアプリの両方で使う */
(function (root) {
"use strict";
function sheetSVG(opts) {
  const E = root.KKS_ENGINE, S = E.SHEET, o = opts || {};
  const font = "'BIZ UDPGothic','Hiragino Sans','Yu Gothic','Meiryo',sans-serif";
  let s = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${S.w} ${S.h}" width="${S.w}mm" height="${S.h}mm" font-family="${font}">`;
  s += `<rect width="${S.w}" height="${S.h}" fill="#fff"/>`;
  // 四隅の目印（左上だけ中が白い）
  S.mark.centers.forEach(([cx, cy], i) => {
    const h = S.mark.size / 2;
    s += `<rect x="${cx - h}" y="${cy - h}" width="${S.mark.size}" height="${S.mark.size}" fill="#000"/>`;
    if (i === 0) { const k = S.mark.hole / 2; s += `<rect x="${cx - k}" y="${cy - k}" width="${S.mark.hole}" height="${S.mark.hole}" fill="#fff"/>`; }
  });
  // 見出し
  s += `<text x="24" y="31" font-size="5" fill="#333">曲名</text>`;
  s += `<line x1="36" y1="32" x2="128" y2="32" stroke="#999" stroke-width="0.3"/>`;
  s += `<text x="186" y="25" font-size="2.6" fill="#777" text-anchor="end">工工四の用紙（本調子）</text>`;
  s += `<text x="186" y="29.5" font-size="2.6" fill="#777" text-anchor="end">撮ると三線で鳴ります</text>`;
  if (o.title) s += `<text x="40" y="30.5" font-size="6" fill="#222">${o.title}</text>`;
  // 列の番号（右から読む）
  for (let c = 0; c < S.cols; c++) {
    const [x] = E.boxOrigin(c, 0);
    s += `<text x="${x + S.box / 2}" y="${S.y0 - 1.6}" font-size="2.8" fill="#888" text-anchor="middle">${c + 1}</text>`;
  }
  // マス目
  for (let c = 0; c < S.cols; c++) {
    const [x, y] = E.boxOrigin(c, 0), H = S.rows * S.box;
    s += `<rect x="${x}" y="${y}" width="${S.box}" height="${H}" fill="none" stroke="#9a9a9a" stroke-width="0.35"/>`;
    for (let r = 1; r < S.rows; r++) {
      const strong = r % 4 === 0;
      s += `<line x1="${x}" y1="${y + r * S.box}" x2="${x + S.box}" y2="${y + r * S.box}" stroke="${strong ? "#777" : "#b4b4b4"}" stroke-width="${strong ? 0.45 : 0.3}"/>`;
    }
    // 歌詞を書く細い欄（読み取りません）
    s += `<rect x="${x + S.box}" y="${y}" width="${S.lyric}" height="${H}" fill="none" stroke="#d0d0d0" stroke-width="0.25"/>`;
  }
  // 見本の字（アプリの見本画像用）
  if (o.fill) for (const f of o.fill) s += f;
  // 書き方
  const yb = S.y0 + S.rows * S.box + 5.2;
  s += `<text x="105" y="${yb}" font-size="2.9" fill="#666" text-anchor="middle">右の列から、上から下へ読みます。1マス＝1拍　〇＝休み　空きマス＝前の音をのばす　縦に2つ書くと半拍ずつ</text>`;
  s += `<text x="105" y="${yb + 4}" font-size="2.6" fill="#888" text-anchor="middle">使える字：合 乙 老 四 上 中 尺 工 五 六 七 八 九 〇　　黒か青のペンで、マスいっぱいに書くと読みやすくなります</text>`;
  s += `</svg>`;
  return s;
}
root.KKS_SHEET = { sheetSVG };
})(typeof window !== "undefined" ? window : globalThis);
