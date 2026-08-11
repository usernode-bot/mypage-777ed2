// Paper Room — the Scene template's photo → digital-environment pipeline.
// Fully client-side and deterministic: canvas passes (levels lift, gentle
// desaturation, hand-traced ink edges, paper grain, deckled border) plus
// on-device person removal via the vendored MediaPipe selfie-segmentation
// model (self-hosted under /vendor/, no CDN — staging has no egress
// guarantees). The platform's LLM proxy is text-only Claude, so no AI
// image call exists anywhere in this pipeline by design; when the
// segmentation model can't run (old browser, missing SIMD) the transform
// simply proceeds without people removal.
(function () {
  'use strict';

  const VENDOR = '/vendor/selfie-segmentation/';
  const MAX_DIM = 1600;

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = () => reject(new Error('script failed: ' + src));
      document.head.appendChild(s);
    });
  }

  function mkCanvas(w, h) {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    return c;
  }

  // ------------------------------------------------------ person removal

  // Resolves a same-size grayscale person-mask canvas, or null when the
  // model can't run here — the caller degrades to "no removal".
  async function personMask(srcCanvas) {
    try {
      if (!window.SelfieSegmentation) await loadScript(VENDOR + 'selfie_segmentation.js');
      const seg = new window.SelfieSegmentation({ locateFile: (f) => VENDOR + f });
      seg.setOptions({ modelSelection: 0, selfieMode: false });
      const results = await new Promise((resolve) => {
        let settled = false;
        const done = (r) => { if (!settled) { settled = true; resolve(r); } };
        const t = setTimeout(() => done(null), 20000);
        seg.onResults((r) => { clearTimeout(t); done(r); });
        Promise.resolve()
          .then(() => seg.send({ image: srcCanvas }))
          .catch(() => { clearTimeout(t); done(null); });
      });
      try { seg.close(); } catch {}
      if (!results || !results.segmentationMask) return null;
      const m = mkCanvas(srcCanvas.width, srcCanvas.height);
      m.getContext('2d').drawImage(results.segmentationMask, 0, 0, m.width, m.height);
      return m;
    } catch {
      return null;
    }
  }

  // Paint the space back in behind the mask: nearest unmasked pixel in the
  // same column (walls/floors extend vertically), averaged top-down and
  // bottom-up, then softened. Any residue is later hidden under a heavier
  // paper wash — imperfection reads as collage, which is the style.
  function removePeople(srcCanvas, maskCanvas) {
    const w = srcCanvas.width;
    const h = srcCanvas.height;
    const mData = maskCanvas.getContext('2d').getImageData(0, 0, w, h).data;

    // Person coverage; skip when negligible (no people / far-away specks).
    let count = 0;
    for (let i = 0; i < mData.length; i += 4) if (mData[i] > 128) count++;
    if (count / (w * h) < 0.004) return { canvas: srcCanvas, removed: false, patch: null };

    // Dilated binary mask (blur + threshold) so the fill covers hair/edges.
    const dil = mkCanvas(w, h);
    const dctx = dil.getContext('2d');
    dctx.filter = 'blur(' + Math.max(4, Math.round(w * 0.012)) + 'px)';
    dctx.drawImage(maskCanvas, 0, 0);
    dctx.filter = 'none';
    const dImg = dctx.getImageData(0, 0, w, h);
    const dd = dImg.data;
    for (let i = 0; i < dd.length; i += 4) {
      const v = dd[i] > 36 ? 255 : 0;
      dd[i] = dd[i + 1] = dd[i + 2] = v;
      dd[i + 3] = v;
    }
    dctx.putImageData(dImg, 0, 0);

    const ctx = srcCanvas.getContext('2d');
    const img = ctx.getImageData(0, 0, w, h);
    const px = img.data;
    const masked = new Uint8Array(w * h);
    for (let p = 0; p < w * h; p++) masked[p] = dd[p * 4] > 128 ? 1 : 0;

    // Column fill, two passes (down then up), averaging both candidates.
    const fillTop = new Float32Array(w * h * 3);
    const hasTop = new Uint8Array(w * h);
    for (let x = 0; x < w; x++) {
      let have = false, r = 0, g = 0, b = 0;
      for (let y = 0; y < h; y++) {
        const p = y * w + x;
        if (!masked[p]) {
          r = px[p * 4]; g = px[p * 4 + 1]; b = px[p * 4 + 2];
          have = true;
        } else if (have) {
          fillTop[p * 3] = r; fillTop[p * 3 + 1] = g; fillTop[p * 3 + 2] = b;
          hasTop[p] = 1;
        }
      }
    }
    for (let x = 0; x < w; x++) {
      let have = false, r = 0, g = 0, b = 0;
      for (let y = h - 1; y >= 0; y--) {
        const p = y * w + x;
        if (!masked[p]) {
          r = px[p * 4]; g = px[p * 4 + 1]; b = px[p * 4 + 2];
          have = true;
        } else {
          let nr, ng, nb;
          if (have && hasTop[p]) {
            nr = (r + fillTop[p * 3]) / 2; ng = (g + fillTop[p * 3 + 1]) / 2; nb = (b + fillTop[p * 3 + 2]) / 2;
          } else if (have) {
            nr = r; ng = g; nb = b;
          } else if (hasTop[p]) {
            nr = fillTop[p * 3]; ng = fillTop[p * 3 + 1]; nb = fillTop[p * 3 + 2];
          } else {
            nr = 236; ng = 229; nb = 214; // isolated column: paper tone
          }
          px[p * 4] = nr; px[p * 4 + 1] = ng; px[p * 4 + 2] = nb;
        }
      }
    }
    ctx.putImageData(img, 0, 0);

    // Soften the patched region: blurred copy clipped to the mask.
    const soft = mkCanvas(w, h);
    const sctx = soft.getContext('2d');
    sctx.filter = 'blur(' + Math.max(6, Math.round(w * 0.008)) + 'px)';
    sctx.drawImage(srcCanvas, 0, 0);
    sctx.filter = 'none';
    sctx.globalCompositeOperation = 'destination-in';
    sctx.drawImage(dil, 0, 0);
    ctx.drawImage(soft, 0, 0);

    return { canvas: srcCanvas, removed: true, patch: dil };
  }

  // -------------------------------------------------------- stylization

  // Levels lift + gentle desaturation: "printed and kept in a journal".
  function paperTone(canvas) {
    const ctx = canvas.getContext('2d');
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const d = img.data;
    const DESAT = 0.18;
    for (let i = 0; i < d.length; i += 4) {
      let r = d[i], g = d[i + 1], b = d[i + 2];
      const lum = 0.299 * r + 0.587 * g + 0.114 * b;
      r += (lum - r) * DESAT;
      g += (lum - g) * DESAT;
      b += (lum - b) * DESAT;
      // Warm lift: raised black point, pulled white point, blue lifted least.
      d[i] = 27 + r * 0.865;
      d[i + 1] = 26 + g * 0.865;
      d[i + 2] = 22 + b * 0.875;
    }
    ctx.putImageData(img, 0, 0);
  }

  // k-means (k=4) over a small thumbnail → accent tints adapted from the
  // uploaded space itself.
  function extractPalette(canvas) {
    const t = mkCanvas(48, 48);
    t.getContext('2d').drawImage(canvas, 0, 0, 48, 48);
    const d = t.getContext('2d').getImageData(0, 0, 48, 48).data;
    const pts = [];
    for (let i = 0; i < d.length; i += 4) pts.push([d[i], d[i + 1], d[i + 2]]);
    let centers = [pts[0], pts[600], pts[1200], pts[1800]].map((p) => p.slice());
    for (let iter = 0; iter < 8; iter++) {
      const sums = centers.map(() => [0, 0, 0, 0]);
      for (const p of pts) {
        let best = 0, bd = Infinity;
        for (let c = 0; c < centers.length; c++) {
          const dx = p[0] - centers[c][0], dy = p[1] - centers[c][1], dz = p[2] - centers[c][2];
          const dist = dx * dx + dy * dy + dz * dz;
          if (dist < bd) { bd = dist; best = c; }
        }
        sums[best][0] += p[0]; sums[best][1] += p[1]; sums[best][2] += p[2]; sums[best][3]++;
      }
      centers = centers.map((c, i) => sums[i][3]
        ? [sums[i][0] / sums[i][3], sums[i][1] / sums[i][3], sums[i][2] / sums[i][3]]
        : c);
    }
    const hex = (v) => ('0' + Math.round(v).toString(16)).slice(-2);
    return centers.map((c) => '#' + hex(c[0]) + hex(c[1]) + hex(c[2]));
  }

  // Sobel edges of a blurred luminance copy, drawn twice with a small
  // offset at low opacity — faint hand-traced ink lines.
  function inkEdges(canvas) {
    const w2 = Math.max(2, canvas.width >> 1);
    const h2 = Math.max(2, canvas.height >> 1);
    const small = mkCanvas(w2, h2);
    const sctx = small.getContext('2d');
    sctx.filter = 'blur(1px)';
    sctx.drawImage(canvas, 0, 0, w2, h2);
    sctx.filter = 'none';
    const src = sctx.getImageData(0, 0, w2, h2).data;
    const lum = new Float32Array(w2 * h2);
    for (let p = 0; p < w2 * h2; p++) {
      lum[p] = 0.299 * src[p * 4] + 0.587 * src[p * 4 + 1] + 0.114 * src[p * 4 + 2];
    }
    const edge = sctx.createImageData(w2, h2);
    const e = edge.data;
    for (let y = 1; y < h2 - 1; y++) {
      for (let x = 1; x < w2 - 1; x++) {
        const p = y * w2 + x;
        const gx = -lum[p - w2 - 1] - 2 * lum[p - 1] - lum[p + w2 - 1]
                 + lum[p - w2 + 1] + 2 * lum[p + 1] + lum[p + w2 + 1];
        const gy = -lum[p - w2 - 1] - 2 * lum[p - w2] - lum[p - w2 + 1]
                 + lum[p + w2 - 1] + 2 * lum[p + w2] + lum[p + w2 + 1];
        const mag = Math.sqrt(gx * gx + gy * gy);
        if (mag > 70) {
          e[p * 4] = 58; e[p * 4 + 1] = 52; e[p * 4 + 2] = 44; // warm ink
          e[p * 4 + 3] = Math.min(255, (mag - 70) * 2.2);
        }
      }
    }
    sctx.putImageData(edge, 0, 0);
    const ctx = canvas.getContext('2d');
    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.globalAlpha = 0.12;
    ctx.drawImage(small, 0, 0, canvas.width, canvas.height);
    ctx.globalAlpha = 0.07;
    ctx.drawImage(small, 1.5, -1, canvas.width, canvas.height); // hand-traced double line
    ctx.restore();
  }

  // Procedural value-noise paper grain, composited soft-light; the removal
  // patch gets an extra off-white paper wash so any fill smear reads as
  // deliberate collage.
  function paperGrain(canvas, patch) {
    const tile = mkCanvas(160, 160);
    const tctx = tile.getContext('2d');
    const img = tctx.createImageData(160, 160);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = 116 + Math.random() * 26 + (Math.random() < 0.03 ? 34 : 0); // flecks
      img.data[i] = img.data[i + 1] = v;
      img.data[i + 2] = v - 6; // warm
      img.data[i + 3] = 255;
    }
    tctx.putImageData(img, 0, 0);
    const ctx = canvas.getContext('2d');
    ctx.save();
    ctx.globalCompositeOperation = 'soft-light';
    ctx.globalAlpha = 0.55;
    ctx.fillStyle = ctx.createPattern(tile, 'repeat');
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.restore();
    if (patch) {
      const wash = mkCanvas(canvas.width, canvas.height);
      const wctx = wash.getContext('2d');
      wctx.fillStyle = 'rgba(243,237,223,0.30)';
      wctx.fillRect(0, 0, canvas.width, canvas.height);
      wctx.globalCompositeOperation = 'soft-light';
      wctx.globalAlpha = 0.8;
      wctx.fillStyle = wctx.createPattern(tile, 'repeat');
      wctx.fillRect(0, 0, canvas.width, canvas.height);
      wctx.globalCompositeOperation = 'destination-in';
      wctx.globalAlpha = 1;
      wctx.drawImage(patch, 0, 0);
      ctx.drawImage(wash, 0, 0);
    }
  }

  // Deckled (torn-paper) border: off-white ring between the canvas edge and
  // an inner polygon with jittered vertices.
  function deckleEdge(canvas) {
    const w = canvas.width, h = canvas.height;
    const inset = Math.max(6, Math.round(Math.min(w, h) * 0.014));
    const jit = inset * 0.55;
    const step = Math.max(14, Math.round(Math.min(w, h) / 34));
    const ctx = canvas.getContext('2d');
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, w, h);
    const pts = [];
    for (let x = inset; x <= w - inset; x += step) pts.push([x, inset + (Math.random() - 0.5) * jit]);
    for (let y = inset; y <= h - inset; y += step) pts.push([w - inset + (Math.random() - 0.5) * jit, y]);
    for (let x = w - inset; x >= inset; x -= step) pts.push([x, h - inset + (Math.random() - 0.5) * jit]);
    for (let y = h - inset; y >= inset; y -= step) pts.push([inset + (Math.random() - 0.5) * jit, y]);
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.closePath();
    ctx.fillStyle = '#F7F1E4';
    ctx.fill('evenodd');
    ctx.strokeStyle = 'rgba(58,52,44,0.18)';
    ctx.lineWidth = 1.2;
    ctx.stroke();
    ctx.restore();
  }

  // ------------------------------------------------------------ pipeline

  async function transform(file) {
    let bmp;
    try {
      bmp = await createImageBitmap(file);
    } catch {
      throw new Error('Couldn’t read that image');
    }
    const scale = Math.min(1, MAX_DIM / Math.max(bmp.width, bmp.height));
    const w = Math.max(2, Math.round(bmp.width * scale));
    const h = Math.max(2, Math.round(bmp.height * scale));
    const canvas = mkCanvas(w, h);
    canvas.getContext('2d').drawImage(bmp, 0, 0, w, h);

    const mask = await personMask(canvas);
    const removal = mask
      ? removePeople(canvas, mask)
      : { canvas, removed: false, patch: null };

    paperTone(canvas);
    const accents = extractPalette(canvas);
    inkEdges(canvas);
    paperGrain(canvas, removal.patch);
    deckleEdge(canvas);

    let quality = 0.85;
    let blob = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', quality));
    while (blob && blob.size > 1.9 * 1024 * 1024 && quality > 0.5) {
      quality -= 0.12;
      blob = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', quality));
    }
    if (!blob) throw new Error('Couldn’t process that photo');
    return { blob, accents, removedPeople: removal.removed };
  }

  // ----------------------------------------------------------- doodles

  // Hand-drawn ink doodles scattered as ordinary sticker BLOCKS — movable,
  // rotatable, deletable. Deterministic per asset id so re-renders match.
  function doodleBlocks(seed, uid) {
    let s = ((Number(seed) || 1) * 2654435761) >>> 0;
    const rnd = () => {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 4294967296;
    };
    const keys = ['doodle-star', 'doodle-sparkle', 'doodle-squiggle', 'doodle-clickme', 'doodle-heart', 'doodle-tape'];
    // Edge-biased slots: doodles decorate the scene, never bury its middle.
    const slots = [
      { x: 3, y: 60 }, { x: 86, y: 90 }, { x: 5, y: 260 },
      { x: 84, y: 300 }, { x: 8, y: 470 }, { x: 74, y: 500 },
    ];
    const n = 4 + Math.floor(rnd() * 3); // 4–6
    const blocks = [];
    for (let i = 0; i < n; i++) {
      const key = keys[i % keys.length];
      const slot = slots[i % slots.length];
      const wide = key === 'doodle-clickme' || key === 'doodle-tape';
      blocks.push({
        id: uid('b'),
        type: 'sticker',
        x: Math.round(slot.x + rnd() * 6 - 3),
        y: Math.round(slot.y + rnd() * 44 - 22),
        w: wide ? 18 : 9,
        rotation: Math.round(rnd() * 24 - 12),
        z: 1,
        props: { key },
      });
    }
    return blocks;
  }

  window.MPScene = { transform, doodleBlocks };
})();
