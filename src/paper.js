import QRCode from 'qrcode';
import jsQR from 'jsqr';

const WIDTH = 1240;
const HEIGHT = 1754;
const MARKER = 136;
const CORNERS = [[90, 90], [1150, 90], [1150, 1664], [90, 1664]];
export const PAGE_SIZE = 5;
const LEFT = 108;
const RIGHT = 1132;
const TOP = 267;
const ROW = 263;
const ANSWER_TOP = 120;
const ANSWER_HEIGHT = 122;

function canvas(width, height) {
  const result = document.createElement('canvas');
  result.width = width;
  result.height = height;
  return result;
}

function markerText(session, page, corner) {
  return `PA:${session.id.replaceAll('-', '')}:${session.round}:${page}:${corner}`;
}

function wrap(ctx, value, width) {
  return value.split('\n').flatMap(paragraph => {
    const lines = [''];
    for (const chunk of paragraph.match(/[^\s\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]+|./gu) ?? []) {
      if (lines.at(-1) && ctx.measureText(lines.at(-1) + chunk).width > width) lines.push('');
      for (const character of chunk) {
        if (ctx.measureText(lines.at(-1) + character).width > width) lines.push('');
        lines[lines.length - 1] += character;
      }
    }
    return lines;
  });
}

export async function worksheet(session) {
  const { jsPDF } = await import('jspdf');
  const pdf = new jsPDF({ format: 'a4', compress: true });
  const pages = Math.ceil(session.questions.length / PAGE_SIZE);
  const sheet = canvas(WIDTH, HEIGHT);
  const ctx = sheet.getContext('2d');
  for (let page = 0; page < pages; page++) {
    if (page) pdf.addPage();
    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
    await Promise.all(CORNERS.map(async ([x, y], corner) => {
      const marker = canvas(MARKER, MARKER);
      await QRCode.toCanvas(marker, markerText(session, page, corner), { width: MARKER, margin: 3, errorCorrectionLevel: 'M' });
      ctx.drawImage(marker, x - MARKER / 2, y - MARKER / 2);
    }));
    ctx.fillStyle = '#172b24';
    ctx.font = 'bold 46px system-ui, sans-serif';
    ctx.fillText('Parallel Anki', LEFT, 204);
    ctx.textAlign = 'right';
    ctx.font = '27px system-ui, sans-serif';
    ctx.fillText(`${session.round}周目   ${page + 1} / ${pages}`, RIGHT, 200);
    ctx.textAlign = 'left';
    const start = page * PAGE_SIZE;
    session.questions.slice(start, start + PAGE_SIZE).forEach((question, index) => {
      const y = TOP + index * ROW;
      ctx.font = 'bold 27px system-ui, sans-serif';
      ctx.fillText(`${start + index + 1}.`, LEFT, y + 21);
      let size = 31;
      let lines;
      do {
        ctx.font = `${size}px system-ui, sans-serif`;
        lines = wrap(ctx, question.prompt.replace(/\s+/gu, ' '), RIGHT - LEFT - 67);
        if (lines.length * size * 1.2 <= 104 || size <= 4) break;
        size--;
      } while (true);
      lines.forEach((line, i) => ctx.fillText(line, LEFT + 62, y + size + i * size * 1.2));
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#9da9a3';
      ctx.strokeRect(LEFT, y + ANSWER_TOP, RIGHT - LEFT, ANSWER_HEIGHT);
    });
    pdf.addImage(sheet.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, 210, 297);
  }
  return pdf.output('blob');
}

// A homography maps normalized worksheet coordinates onto the photographed QR centers.
function projection([p0, p1, p2, p3]) {
  const dx = p0.x - p1.x + p2.x - p3.x;
  const dy = p0.y - p1.y + p2.y - p3.y;
  const ax = p1.x - p2.x, ay = p1.y - p2.y;
  const bx = p3.x - p2.x, by = p3.y - p2.y;
  const determinant = ax * by - bx * ay;
  if (Math.abs(determinant) < 1000) throw new Error('用紙を上から撮り直してください。');
  const g = (dx * by - bx * dy) / determinant;
  const h = (ax * dy - dx * ay) / determinant;
  return (x, y) => {
    const u = (x - CORNERS[0][0]) / (CORNERS[1][0] - CORNERS[0][0]);
    const v = (y - CORNERS[0][1]) / (CORNERS[3][1] - CORNERS[0][1]);
    const scale = 1 + g * u + h * v;
    return [
      ((p1.x * (1 + g) - p0.x) * u + (p3.x * (1 + h) - p0.x) * v + p0.x) / scale,
      ((p1.y * (1 + g) - p0.y) * u + (p3.y * (1 + h) - p0.y) * v + p0.y) / scale,
    ];
  };
}

function intersection(a, b, c, d) {
  const s = ((a.x - c.x) * (c.y - d.y) - (a.y - c.y) * (c.x - d.x)) /
    ((a.x - b.x) * (c.y - d.y) - (a.y - b.y) * (c.x - d.x));
  return { x: a.x + (b.x - a.x) * s, y: a.y + (b.y - a.y) * s };
}

function detectMarkers(source, session) {
  const ctx = source.getContext('2d', { willReadFrequently: true });
  const sourcePixels = ctx.getImageData(0, 0, source.width, source.height);
  const points = [];
  let page;
  const sample = canvas(1, 1);
  const sampleContext = sample.getContext('2d', { willReadFrequently: true });
  // Different sample sizes help with small or slightly blurred QR modules.
  const w = source.width, h = source.height;
  const regions = [.34, .61].flatMap(size => [[0, 0], [1 - size, 0], [1 - size, 1 - size], [0, 1 - size]]
    .map(([x, y]) => [x, y, size]));
  regions.push([0, 0, 1]);
  for (const [left, top, size] of regions) {
    if (points.filter(Boolean).length === 4) break;
    const x = Math.round(left * w), y = Math.round(top * h);
    const sw = Math.min(w - x, Math.round(size * w)), sh = Math.min(h - y, Math.round(size * h));
    const attempts = size === 1 ? 8 : 1;
    for (let attempt = 0; attempt < attempts && points.filter(Boolean).length < 4; attempt++) {
      let result;
      for (const scale of size === 1 ? [1, .72] : [1, .7, 1.5]) {
        sample.width = Math.round(sw * scale);
        sample.height = Math.round(sh * scale);
        if (!sample.width || !sample.height) continue;
        sampleContext.drawImage(source, x, y, sw, sh, 0, 0, sample.width, sample.height);
        const pixels = sampleContext.getImageData(0, 0, sample.width, sample.height);
        const found = jsQR(pixels.data, sample.width, sample.height, { inversionAttempts: 'dontInvert' });
        if (!found) continue;
        const loc = found.location;
        result = { data: found.data, corners: [loc.topLeftCorner, loc.topRightCorner, loc.bottomRightCorner, loc.bottomLeftCorner]
          .map(point => ({ x: x + point.x * sw / sample.width, y: y + point.y * sh / sample.height })) };
        break;
      }
      if (!result) break;
      const { corners } = result;
      const match = /^PA:([a-f0-9]{32}):(\d+):(\d+):([0-3])$/.exec(result.data);
      if (match) {
        const [, id, round, index, corner] = match;
        if (id !== session.id.replaceAll('-', '') || Number(round) !== session.round)
          throw new Error('現在の復習で作成した用紙を撮影してください。');
        if (page !== undefined && page !== Number(index)) throw new Error('1枚ずつ撮影してください。');
        page = Number(index);
        points[Number(corner)] = intersection(corners[0], corners[2], corners[1], corners[3]);
      }
      const xs = corners.map(point => point.x), ys = corners.map(point => point.y);
      ctx.fillStyle = 'white';
      ctx.fillRect(Math.min(...xs) - 4, Math.min(...ys) - 4,
        Math.max(...xs) - Math.min(...xs) + 8, Math.max(...ys) - Math.min(...ys) + 8);
    }
  }
  if (points.filter(Boolean).length !== 4 || page >= Math.ceil(session.questions.length / PAGE_SIZE)) {
    throw new Error('四隅のマーカーが読み取れませんでした。用紙全体を明るい場所で撮影してください。');
  }
  return { page, points, sourcePixels };
}

export async function scanSheet(file, session) {
  let bitmap;
  try { bitmap = await createImageBitmap(file); }
  catch { throw new Error('画像を開けませんでした。JPEG、PNG、または端末のカメラでお試しください。'); }
  const scale = Math.min(1, 2200 / Math.max(bitmap.width, bitmap.height));
  const source = canvas(Math.round(bitmap.width * scale), Math.round(bitmap.height * scale));
  source.getContext('2d', { willReadFrequently: true }).drawImage(bitmap, 0, 0, source.width, source.height);
  bitmap.close();
  const { page, points, sourcePixels } = detectMarkers(source, session);
  const map = projection(points);
  const questions = session.questions.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const crop = canvas(1000, questions.length * 146);
  const ctx = crop.getContext('2d');
  ctx.fillStyle = 'white';
  ctx.fillRect(0, 0, crop.width, crop.height);
  const sourceData = sourcePixels.data;
  const previews = [];
  questions.forEach((_, index) => {
    const row = ctx.createImageData(929, 108);
    for (let y = 0; y < row.height; y++) {
      for (let x = 0; x < row.width; x++) {
        const [sx, sy] = map(LEFT + 5 + x * (RIGHT - LEFT - 10) / row.width,
          TOP + index * ROW + ANSWER_TOP + 5 + y * (ANSWER_HEIGHT - 10) / row.height);
        const pixel = (Math.round(sy) * source.width + Math.round(sx)) * 4;
        const offset = (y * row.width + x) * 4;
        const gray = (sourceData[pixel] + sourceData[pixel + 1] + sourceData[pixel + 2]) / 3;
        const contrast = Number.isFinite(gray) ? Math.min(255, Math.max(0, (gray - 65) * 1.32)) : 255;
        row.data.set([contrast, contrast, contrast, 255], offset);
      }
    }
    const preview = canvas(row.width, row.height);
    preview.getContext('2d').putImageData(row, 0, 0);
    previews.push(preview.toDataURL('image/jpeg', 0.78));
    ctx.putImageData(row, 62, index * 146 + 8);
    ctx.fillStyle = '#222';
    ctx.font = 'bold 26px sans-serif';
    ctx.fillText(`${index + 1}.`, 14, index * 146 + 45);
    ctx.strokeStyle = '#ccc';
    ctx.beginPath();
    ctx.moveTo(0, (index + 1) * 146 - 1);
    ctx.lineTo(1000, (index + 1) * 146 - 1);
    ctx.stroke();
  });
  return { page, image: crop.toDataURL('image/jpeg', 0.86), previews };
}
