/* Small QR decoder (byte mode, versions 1-40) so a laptop webcam can scan where BarcodeDetector is missing.
   decodeQr(imageData) -> string | null. Uses the RS block / format tables from qr.js. */
(function () {
  const EXP = new Uint8Array(512), LOG = new Uint8Array(256);
  (function () { let x = 1; for (let i = 0; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 256) x ^= 0x11d; } for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255]; })();
  const mul = (a, b) => (a && b ? EXP[LOG[a] + LOG[b]] : 0);
  const inv = (a) => EXP[255 - LOG[a]];

  function rsCorrect(msg, ecc) {                       // msg = data+ecc codewords, returns corrected copy or null
    const n = msg.length, m = msg.slice();
    const syn = (a) => { const S = []; let bad = false; for (let i = 0; i < ecc; i++) { let y = 0; for (let k = 0; k < n; k++) y = mul(y, EXP[i]) ^ a[k]; S.push(y); if (y) bad = true; } return bad ? S : null; };
    const S = syn(m); if (!S) return m;
    let C = [1], B = [1], L = 0, mm = 1, b = 1;
    for (let i = 0; i < ecc; i++) {
      let d = S[i]; for (let j = 1; j <= L; j++) d ^= mul(C[j] || 0, S[i - j]);
      if (!d) { mm++; continue; }
      const T = C.slice(), coef = mul(d, inv(b));
      while (C.length < B.length + mm) C.push(0);
      for (let j = 0; j < B.length; j++) C[j + mm] ^= mul(coef, B[j]);
      if (2 * L <= i) { L = i + 1 - L; B = T; b = d; mm = 1; } else mm++;
    }
    if (L * 2 > ecc) return null;
    const pos = [];
    for (let p = 0; p < n; p++) { let y = 0; const xi = EXP[(255 - p) % 255]; for (let j = C.length - 1; j >= 0; j--) y = mul(y, xi) ^ C[j]; if (!y) pos.push(p); }
    if (pos.length !== L) return null;
    const Om = []; for (let i = 0; i < ecc; i++) { let v = 0; for (let j = 0; j <= i && j < C.length; j++) v ^= mul(C[j], S[i - j]); Om.push(v); }
    for (const p of pos) {
      const X = EXP[p], xi = EXP[(255 - p) % 255];
      let om = 0, xp = 1; for (let i = 0; i < ecc; i++) { om ^= mul(Om[i], xp); xp = mul(xp, xi); }
      let dd = 0; for (let j = 1; j < C.length; j += 2) { let t = C[j]; for (let q = 0; q < j - 1; q++) t = mul(t, xi); dd ^= t; }
      if (!dd) return null;
      m[n - 1 - p] ^= mul(X, mul(om, inv(dd)));
    }
    return syn(m) ? null : m;
  }

  function solve8(A, bv) {                              // gaussian elimination
    const n = 8; for (let i = 0; i < n; i++) A[i].push(bv[i]);
    for (let c = 0; c < n; c++) {
      let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
      if (Math.abs(A[p][c]) < 1e-12) return null; [A[c], A[p]] = [A[p], A[c]];
      for (let r = 0; r < n; r++) if (r !== c) { const f = A[r][c] / A[c][c]; for (let k = c; k <= n; k++) A[r][k] -= f * A[c][k]; }
    }
    return A.map((row, i) => row[n] / row[i]);
  }
  function homography(src, dst) {                       // src (module) -> dst (image), 4 points
    const A = [], b = [];
    for (let i = 0; i < 4; i++) {
      const [x, y] = src[i], [u, v] = dst[i];
      A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u);
      A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v);
    }
    const h = solve8(A, b); if (!h) return null;
    return (x, y) => { const w = h[6] * x + h[7] * y + 1; return [(h[0] * x + h[1] * y + h[2]) / w, (h[3] * x + h[4] * y + h[5]) / w]; };
  }

  function binarize(img) {
    const w = img.width, h = img.height, d = img.data, g = new Uint8Array(w * h);
    for (let i = 0, j = 0; i < g.length; i++, j += 4) g[i] = (d[j] * 77 + d[j + 1] * 150 + d[j + 2] * 29) >> 8;
    const W = w + 1, I = new Uint32Array(W * (h + 1));
    for (let y = 0; y < h; y++) { let row = 0; for (let x = 0; x < w; x++) { row += g[y * w + x]; I[(y + 1) * W + x + 1] = I[y * W + x + 1] + row; } }
    const s = Math.max(15, Math.floor(w / 10) | 1), r = s >> 1, bits = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      const y0 = Math.max(0, y - r), y1 = Math.min(h, y + r + 1);
      for (let x = 0; x < w; x++) {
        const x0 = Math.max(0, x - r), x1 = Math.min(w, x + r + 1);
        const sum = I[y1 * W + x1] - I[y0 * W + x1] - I[y1 * W + x0] + I[y0 * W + x0];
        bits[y * w + x] = g[y * w + x] * (x1 - x0) * (y1 - y0) < sum * 0.9 ? 1 : 0;
      }
    }
    return { bits, w, h };
  }

  function runsCheck(runs, ms) { const t = [1, 1, 3, 1, 1]; for (let i = 0; i < 5; i++) if (Math.abs(runs[i] - t[i] * ms) > (i === 2 ? 1.5 : 0.75) * ms) return false; return true; }
  function findFinders(B) {
    const { bits, w, h } = B, cand = [];
    const vert = (x, y) => {                              // verify 1:1:3:1:1 vertically through (x,y); returns refined cy, ms
      const at = (yy) => bits[yy * w + x];
      if (!at(y)) return null;
      let u = y; while (u > 0 && at(u - 1)) u--; let top = y - u + 1;
      let d = y; while (d < h - 1 && at(d + 1)) d++; const cen = d - u + 1;
      let a = u - 1, wa = 0; while (a >= 0 && !at(a)) { a--; wa++; } let ba = 0; while (a >= 0 && at(a)) { a--; ba++; }
      let b = d + 1, wb = 0; while (b < h && !at(b)) { b++; wb++; } let bb = 0; while (b < h && at(b)) { b++; bb++; }
      const runs = [ba, wa, cen, wb, bb], tot = ba + wa + cen + wb + bb, ms = tot / 7;
      if (!runsCheck(runs, ms)) return null;
      return { cy: (u + d) / 2 + 0.5, ms: ms };
    };
    for (let y = 0; y < h; y += 1) {
      const runs = [], starts = []; let cur = bits[y * w], st = 0;
      for (let x = 1; x <= w; x++) { const v = x < w ? bits[y * w + x] : -1; if (v !== cur) { runs.push(x - st); starts.push(st); st = x; cur = v; } }
      let col0 = bits[y * w];                              // colour of runs[0]
      for (let i = 0; i + 4 < runs.length; i++) {
        if (((col0 + i) & 1) !== 1) continue;             // must start on a dark run
        const r5 = runs.slice(i, i + 5), tot = r5[0] + r5[1] + r5[2] + r5[3] + r5[4], ms = tot / 7;
        if (ms < 1.5 || !runsCheck(r5, ms)) continue;
        const cx = Math.floor(starts[i + 2] + runs[i + 2] / 2);
        const v = vert(cx, y); if (!v) continue;
        const x = starts[i] + tot / 2, m = (ms + v.ms) / 2;
        const hit = cand.find((c) => Math.hypot(c.x - x, c.y - v.cy) < m * 3);
        if (hit) { hit.x = (hit.x * hit.n + x) / (hit.n + 1); hit.y = (hit.y * hit.n + v.cy) / (hit.n + 1); hit.ms = (hit.ms * hit.n + m) / (hit.n + 1); hit.n++; }
        else cand.push({ x: x, y: v.cy, ms: m, n: 1 });
      }
    }
    return cand.filter((c) => c.n >= 2).sort((a, b) => b.n - a.n).slice(0, 8);
  }

  function pickTriple(c) {
    let best = null;
    for (let i = 0; i < c.length; i++) for (let j = 0; j < c.length; j++) for (let k = j + 1; k < c.length; k++) {
      if (i === j || i === k) continue;
      const a = c[i], b = c[j], d = c[k];
      const v1 = [b.x - a.x, b.y - a.y], v2 = [d.x - a.x, d.y - a.y];
      const l1 = Math.hypot(v1[0], v1[1]), l2 = Math.hypot(v2[0], v2[1]);
      if (l1 < 10 || l2 < 10 || l1 / l2 > 2 || l2 / l1 > 2) continue;
      const cos = Math.abs((v1[0] * v2[0] + v1[1] * v2[1]) / (l1 * l2)); if (cos > 0.75) continue;
      const sc = Math.abs(l1 - l2) / Math.max(l1, l2) + cos; if (!best || sc < best.sc) best = { sc, a, b, d, v1, v2 };
    }
    if (!best) return null;
    const cr = best.v1[0] * best.v2[1] - best.v1[1] * best.v2[0];
    return cr > 0 ? { tl: best.a, tr: best.b, bl: best.d } : { tl: best.a, tr: best.d, bl: best.b };
  }

  function alignPositions(v) {
    if (v === 1) return [];
    const cnt = Math.floor(v / 7) + 2, last = 4 * v + 10, step = v === 32 ? 26 : Math.ceil((last - 6) / (cnt - 1) / 2) * 2, out = [6];
    for (let p = last; out.length < cnt; p -= step) out.splice(1, 0, p);
    return out;
  }

  function extract(B, f, n, ver, map) {
    const { bits, w, h } = B;
    const bit = (c, r) => {                               // majority of 5 samples inside module (c,r)
      let s = 0; for (const [dx, dy] of [[0.5, 0.5], [0.3, 0.5], [0.7, 0.5], [0.5, 0.3], [0.5, 0.7]]) {
        const [x, y] = map(c + dx, r + dy), xi = Math.round(x - 0.5), yi = Math.round(y - 0.5);
        if (xi >= 0 && yi >= 0 && xi < w && yi < h) s += bits[yi * w + xi];
      } return s >= 3 ? 1 : 0;
    };
    const rd = (r, c) => bit(c, r);
    const I = window._qrInt;
    const fmt = [];
    for (let i = 0; i < 15; i++) {
      const a = i < 6 ? rd(i, 8) : i < 8 ? rd(i + 1, 8) : rd(n - 15 + i, 8);
      const b = i < 8 ? rd(8, n - i - 1) : i < 9 ? rd(8, 15 - i) : rd(8, 14 - i);
      fmt.push([a, b]);
    }
    let w1 = 0, w2 = 0; for (let i = 0; i < 15; i++) { w1 |= fmt[i][0] << i; w2 |= fmt[i][1] << i; }
    let bestF = null, bd = 99;
    for (let d = 0; d < 32; d++) {
      const word = I.U.getBCHTypeInfo(d), pc = (x) => { let c = 0; while (x) { c += x & 1; x >>= 1; } return c; };
      const dist = Math.min(pc(word ^ w1), pc(word ^ w2)); if (dist < bd) { bd = dist; bestF = d; }
    }
    if (bd > 3) return null;
    const ecl = bestF >> 3, mask = bestF & 7;
    const fn = [];                                        // function-pattern map
    for (let r = 0; r < n; r++) fn.push(new Uint8Array(n));
    const box = (r0, c0, r1, c1) => { for (let r = Math.max(0, r0); r <= Math.min(n - 1, r1); r++) for (let c = Math.max(0, c0); c <= Math.min(n - 1, c1); c++) fn[r][c] = 1; };
    box(0, 0, 8, 8); box(0, n - 8, 8, n - 1); box(n - 8, 0, n - 1, 8);
    for (let i = 0; i < n; i++) { fn[6][i] = 1; fn[i][6] = 1; }
    const ap = alignPositions(ver);
    for (const r of ap) for (const c of ap) { if ((r === 6 && c === 6) || (r === 6 && c === ap[ap.length - 1]) || (c === 6 && r === ap[ap.length - 1])) continue; box(r - 2, c - 2, r + 2, c + 2); }
    if (ver >= 7) { box(0, n - 11, 5, n - 9); box(n - 11, 0, n - 9, 5); }
    const M = [(i, j) => (i + j) % 2 === 0, (i) => i % 2 === 0, (i, j) => j % 3 === 0, (i, j) => (i + j) % 3 === 0,
      (i, j) => (Math.floor(i / 2) + Math.floor(j / 3)) % 2 === 0, (i, j) => ((i * j) % 2) + ((i * j) % 3) === 0,
      (i, j) => (((i * j) % 2) + ((i * j) % 3)) % 2 === 0, (i, j) => (((i * j) % 3) + ((i + j) % 2)) % 2 === 0][mask];
    const out = []; let up = true;
    for (let col = n - 1; col > 0; col -= 2) {
      if (col === 6) col--;
      for (let k = 0; k < n; k++) {
        const r = up ? n - 1 - k : k;
        for (let c = col; c >= col - 1; c--) if (!fn[r][c]) out.push(rd(r, c) ^ (M(r, c) ? 1 : 0));
      }
      up = !up;
    }
    const cw = []; for (let i = 0; i + 7 < out.length; i += 8) { let v = 0; for (let k = 0; k < 8; k++) v = (v << 1) | out[i + k]; cw.push(v); }
    const blocks = I.RS.getRSBlocks(ver, ecl), nb = blocks.length;
    const data = blocks.map(() => []), ecc = blocks.map(() => []);
    let p = 0; const maxD = Math.max(...blocks.map((b) => b.dataCount)), maxE = Math.max(...blocks.map((b) => b.totalCount - b.dataCount));
    for (let i = 0; i < maxD; i++) for (let r = 0; r < nb; r++) if (i < blocks[r].dataCount) data[r].push(cw[p++]);
    for (let i = 0; i < maxE; i++) for (let r = 0; r < nb; r++) if (i < blocks[r].totalCount - blocks[r].dataCount) ecc[r].push(cw[p++]);
    let all = [];
    for (let r = 0; r < nb; r++) { const fixed = rsCorrect(data[r].concat(ecc[r]), ecc[r].length); if (!fixed) return null; all = all.concat(fixed.slice(0, data[r].length)); }
    let pos = 0; const rb = (c) => { let v = 0; for (let i = 0; i < c; i++, pos++) v = (v << 1) | ((all[pos >> 3] >> (7 - (pos & 7))) & 1); return v; };
    let res = "";
    while (pos + 4 <= all.length * 8) {
      const mode = rb(4); if (mode === 0) break; if (mode !== 4) return null;
      const cnt = rb(ver < 10 ? 8 : 16); for (let i = 0; i < cnt; i++) res += String.fromCharCode(rb(8));
    }
    return res;
  }

  window.decodeQr = function (img) {
    try {
      const B = binarize(img), fp = findFinders(B), t = fp.length >= 3 ? pickTriple(fp) : null; if (!t) return null;
      const { tl, tr, bl } = t, ms = (tl.ms + tr.ms + bl.ms) / 3;
      const est = Math.hypot(tr.x - tl.x, tr.y - tl.y) / ms + 7;
      const tries = []; const v0 = Math.round((est - 17) / 4); for (const v of [v0, v0 - 1, v0 + 1]) if (v >= 1 && v <= 40) tries.push(v);
      for (const ver of tries) {
        const n = 17 + 4 * ver, br = [tr.x + bl.x - tl.x, tr.y + bl.y - tl.y];
        const pts = [[3.5, 3.5], [n - 3.5, 3.5], [3.5, n - 3.5], [n - 3.5, n - 3.5]], img4 = [[tl.x, tl.y], [tr.x, tr.y], [bl.x, bl.y], br];
        let map = homography(pts, img4); if (!map) continue;
        if (ver >= 2) {                                    // refine with the bottom-right alignment pattern
          const { bits, w, h } = B, ac = n - 6.5; let best = -1, bx = 0, by = 0;
          for (let dy = -3; dy <= 3; dy += 0.5) for (let dx = -3; dx <= 3; dx += 0.5) {
            let sc = 0;
            for (let j = -2; j <= 2; j++) for (let i = -2; i <= 2; i++) {
              const [x, y] = map(ac + dx + i, ac + dy + j), xi = Math.round(x - 0.5), yi = Math.round(y - 0.5);
              const dark = xi >= 0 && yi >= 0 && xi < w && yi < h ? bits[yi * w + xi] : 0, want = Math.max(Math.abs(i), Math.abs(j)) !== 1 ? 1 : 0;
              if (dark === want) sc++;
            }
            if (sc > best) { best = sc; bx = dx; by = dy; }
          }
          if (best >= 22) { const m2 = homography([pts[0], pts[1], pts[2], [ac, ac]], [img4[0], img4[1], img4[2], map(ac + bx, ac + by)]); if (m2) map = m2; }
        }
        const r = extract(B, null, n, ver, map); if (r) return r;
      }
    } catch (e) {}
    return null;
  };
})();
