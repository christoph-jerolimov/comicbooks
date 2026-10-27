// Generates a small set of sample comic books into public/comics/<slug>/.
// Each page is drawn procedurally as SVG and rasterized to PNG with sharp.
// Run with: npm run generate:samples
import { mkdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const OUT = path.resolve('public/comics');
const W = 1200;
const H = 1600;

// ---------- tiny seeded RNG so output is reproducible ----------
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// ---------- drawing helpers ----------
function halftone(id, color, r = 3, gap = 14) {
  return `<pattern id="${id}" width="${gap}" height="${gap}" patternUnits="userSpaceOnUse" patternTransform="rotate(30)"><circle cx="${gap / 2}" cy="${gap / 2}" r="${r}" fill="${color}"/></pattern>`;
}

function star(cx, cy, r, fill) {
  const pts = [];
  for (let i = 0; i < 10; i++) {
    const a = (Math.PI / 5) * i - Math.PI / 2;
    const rr = i % 2 ? r * 0.45 : r;
    pts.push(`${(cx + Math.cos(a) * rr).toFixed(1)},${(cy + Math.sin(a) * rr).toFixed(1)}`);
  }
  return `<polygon points="${pts.join(' ')}" fill="${fill}" stroke="#111" stroke-width="4" stroke-linejoin="round"/>`;
}

function bubble(x, y, w, lines, { tailX = x + 40, tailY, shout = false } = {}) {
  const lh = 38;
  const h = lines.length * lh + 34;
  tailY ??= y + h + 40;
  const body = shout
    ? `<polygon points="${x - 10},${y + 20} ${x + 20},${y - 10} ${x + w * 0.3},${y + 8} ${x + w * 0.55},${y - 14} ${x + w * 0.7},${y + 10} ${x + w + 12},${y} ${x + w - 4},${y + h * 0.4} ${x + w + 16},${y + h * 0.7} ${x + w - 10},${y + h} ${x + w * 0.5},${y + h - 6} ${x + w * 0.2},${y + h + 12} ${x + 10},${y + h - 8} ${x - 14},${y + h * 0.5}" fill="#fff" stroke="#111" stroke-width="5" stroke-linejoin="round"/>`
    : `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${h / 2.2}" fill="#fff" stroke="#111" stroke-width="5"/>
       <polygon points="${tailX},${y + h - 6} ${tailX + 36},${y + h - 6} ${tailX + 8},${tailY}" fill="#fff" stroke="#111" stroke-width="5" stroke-linejoin="round"/>
       <rect x="${tailX + 2}" y="${y + h - 12}" width="${32}" height="12" fill="#fff"/>`;
  const text = lines
    .map((l, i) => `<text x="${x + w / 2}" y="${y + 24 + lh * (i + 1) - 8}" text-anchor="middle" font-family="'Comic Sans MS','Chalkboard SE','Marker Felt',sans-serif" font-weight="700" font-size="${shout ? 34 : 28}" fill="#111">${esc(l)}</text>`)
    .join('');
  return body + text;
}

function caption(x, y, w, text) {
  return `<rect x="${x}" y="${y}" width="${w}" height="52" fill="#fff6c8" stroke="#111" stroke-width="5"/>
    <text x="${x + 16}" y="${y + 36}" font-family="Georgia,serif" font-style="italic" font-size="26" fill="#111">${esc(text)}</text>`;
}

// A simple cartoon character built from primitives.
function character(cx, cy, scale, { body = '#ff6b35', skin = '#ffd7b5', hat = null, antenna = false, pose = 'stand', eyes = 'open' } = {}) {
  const s = scale;
  const g = [];
  const legOff = pose === 'run' ? 26 : 0;
  g.push(`<g stroke="#111" stroke-width="${5 * s}" stroke-linecap="round" stroke-linejoin="round">`);
  // legs
  g.push(`<line x1="${cx - 18 * s}" y1="${cy + 60 * s}" x2="${cx - (18 + legOff) * s}" y2="${cy + 130 * s}" stroke="#111"/>`);
  g.push(`<line x1="${cx + 18 * s}" y1="${cy + 60 * s}" x2="${cx + (18 + legOff) * s}" y2="${cy + 130 * s}" stroke="#111"/>`);
  // body
  g.push(`<rect x="${cx - 45 * s}" y="${cy - 10 * s}" width="${90 * s}" height="${80 * s}" rx="${22 * s}" fill="${body}"/>`);
  // arms
  const armUp = pose === 'wave' || pose === 'cheer';
  g.push(`<line x1="${cx - 45 * s}" y1="${cy + 10 * s}" x2="${cx - 95 * s}" y2="${cy + (armUp ? -50 : 55) * s}"/>`);
  g.push(`<line x1="${cx + 45 * s}" y1="${cy + 10 * s}" x2="${cx + 95 * s}" y2="${cy + (pose === 'cheer' ? -50 : 55) * s}"/>`);
  // head
  g.push(`<circle cx="${cx}" cy="${cy - 60 * s}" r="${52 * s}" fill="${skin}"/>`);
  // eyes
  if (eyes === 'open') {
    g.push(`<circle cx="${cx - 18 * s}" cy="${cy - 66 * s}" r="${8 * s}" fill="#111" stroke="none"/>`);
    g.push(`<circle cx="${cx + 18 * s}" cy="${cy - 66 * s}" r="${8 * s}" fill="#111" stroke="none"/>`);
  } else if (eyes === 'wide') {
    g.push(`<circle cx="${cx - 18 * s}" cy="${cy - 66 * s}" r="${14 * s}" fill="#fff"/><circle cx="${cx - 18 * s}" cy="${cy - 66 * s}" r="${6 * s}" fill="#111" stroke="none"/>`);
    g.push(`<circle cx="${cx + 18 * s}" cy="${cy - 66 * s}" r="${14 * s}" fill="#fff"/><circle cx="${cx + 18 * s}" cy="${cy - 66 * s}" r="${6 * s}" fill="#111" stroke="none"/>`);
  } else {
    g.push(`<path d="M${cx - 28 * s} ${cy - 66 * s} q${10 * s} ${-10 * s} ${20 * s} 0 M${cx + 8 * s} ${cy - 66 * s} q${10 * s} ${-10 * s} ${20 * s} 0" fill="none"/>`);
  }
  // mouth
  g.push(`<path d="M${cx - 20 * s} ${cy - 40 * s} q${20 * s} ${(eyes === 'wide' ? 4 : 22) * s} ${40 * s} 0" fill="none"/>`);
  if (hat === 'helmet') {
    g.push(`<circle cx="${cx}" cy="${cy - 60 * s}" r="${66 * s}" fill="rgba(180,230,255,0.45)" stroke="#111"/>`);
    g.push(`<path d="M${cx - 66 * s} ${cy - 60 * s} a${66 * s} ${66 * s} 0 0 1 ${132 * s} 0" fill="none" stroke="#fff" stroke-width="${3 * s}"/>`);
  } else if (hat === 'knight') {
    g.push(`<path d="M${cx - 56 * s} ${cy - 70 * s} a${56 * s} ${56 * s} 0 0 1 ${112 * s} 0 v${20 * s} h${-112 * s} z" fill="#9aa5b1"/>`);
    g.push(`<rect x="${cx - 6 * s}" y="${cy - 150 * s}" width="${12 * s}" height="${40 * s}" fill="#e63946"/>`);
  } else if (hat === 'cap') {
    g.push(`<path d="M${cx - 56 * s} ${cy - 72 * s} a${56 * s} ${56 * s} 0 0 1 ${112 * s} 0 z" fill="#2b6cb0"/>`);
    g.push(`<rect x="${cx}" y="${cy - 80 * s}" width="${80 * s}" height="${12 * s}" rx="${6 * s}" fill="#2b6cb0"/>`);
  }
  if (antenna) {
    g.push(`<line x1="${cx}" y1="${cy - 112 * s}" x2="${cx}" y2="${cy - 150 * s}"/><circle cx="${cx}" cy="${cy - 158 * s}" r="${12 * s}" fill="#ffd166"/>`);
  }
  g.push('</g>');
  return g.join('');
}

function robot(cx, cy, s, { color = '#8ecae6', eyes = 'open' } = {}) {
  const g = [`<g stroke="#111" stroke-width="${5 * s}" stroke-linejoin="round" stroke-linecap="round">`];
  g.push(`<rect x="${cx - 55 * s}" y="${cy - 20 * s}" width="${110 * s}" height="${110 * s}" rx="${10 * s}" fill="${color}"/>`);
  g.push(`<rect x="${cx - 45 * s}" y="${cy - 120 * s}" width="${90 * s}" height="${80 * s}" rx="${14 * s}" fill="${color}"/>`);
  g.push(`<line x1="${cx}" y1="${cy - 120 * s}" x2="${cx}" y2="${cy - 155 * s}"/><circle cx="${cx}" cy="${cy - 165 * s}" r="${12 * s}" fill="#ff5d5d"/>`);
  if (eyes === 'open') {
    g.push(`<circle cx="${cx - 20 * s}" cy="${cy - 82 * s}" r="${12 * s}" fill="#fff"/><circle cx="${cx + 20 * s}" cy="${cy - 82 * s}" r="${12 * s}" fill="#fff"/>`);
    g.push(`<circle cx="${cx - 20 * s}" cy="${cy - 82 * s}" r="${5 * s}" fill="#111" stroke="none"/><circle cx="${cx + 20 * s}" cy="${cy - 82 * s}" r="${5 * s}" fill="#111" stroke="none"/>`);
  } else {
    g.push(`<rect x="${cx - 32 * s}" y="${cy - 90 * s}" width="${64 * s}" height="${16 * s}" rx="${8 * s}" fill="#3bd16f"/>`);
  }
  g.push(`<rect x="${cx - 22 * s}" y="${cy - 60 * s}" width="${44 * s}" height="${10 * s}" rx="${5 * s}" fill="#111" stroke="none"/>`);
  g.push(`<line x1="${cx - 55 * s}" y1="${cy + 10 * s}" x2="${cx - 100 * s}" y2="${cy + 50 * s}"/><line x1="${cx + 55 * s}" y1="${cy + 10 * s}" x2="${cx + 100 * s}" y2="${cy - 30 * s}"/>`);
  g.push(`<rect x="${cx - 45 * s}" y="${cy + 90 * s}" width="${30 * s}" height="${45 * s}" fill="#555"/><rect x="${cx + 15 * s}" y="${cy + 90 * s}" width="${30 * s}" height="${45 * s}" fill="#555"/>`);
  g.push(`<circle cx="${cx}" cy="${cy + 35 * s}" r="${18 * s}" fill="#ffd166"/>`);
  g.push('</g>');
  return g.join('');
}

function cat(cx, cy, s, { color = '#f4a261' } = {}) {
  const g = [`<g stroke="#111" stroke-width="${5 * s}" stroke-linejoin="round" stroke-linecap="round">`];
  g.push(`<ellipse cx="${cx}" cy="${cy + 40 * s}" rx="${70 * s}" ry="${55 * s}" fill="${color}"/>`);
  g.push(`<path d="M${cx + 60 * s} ${cy + 40 * s} q${60 * s} ${-20 * s} ${40 * s} ${-80 * s}" fill="none" stroke-width="${12 * s}" stroke="${color}"/>`);
  g.push(`<path d="M${cx + 60 * s} ${cy + 40 * s} q${60 * s} ${-20 * s} ${40 * s} ${-80 * s}" fill="none"/>`);
  g.push(`<circle cx="${cx - 10 * s}" cy="${cy - 30 * s}" r="${48 * s}" fill="${color}"/>`);
  g.push(`<polygon points="${cx - 50 * s},${cy - 55 * s} ${cx - 45 * s},${cy - 105 * s} ${cx - 15 * s},${cy - 70 * s}" fill="${color}"/>`);
  g.push(`<polygon points="${cx + 30 * s},${cy - 55 * s} ${cx + 25 * s},${cy - 105 * s} ${cx - 5 * s},${cy - 70 * s}" fill="${color}"/>`);
  g.push(`<circle cx="${cx - 28 * s}" cy="${cy - 36 * s}" r="${7 * s}" fill="#111" stroke="none"/><circle cx="${cx + 6 * s}" cy="${cy - 36 * s}" r="${7 * s}" fill="#111" stroke="none"/>`);
  g.push(`<path d="M${cx - 16 * s} ${cy - 18 * s} l${6 * s} ${6 * s} l${6 * s} ${-6 * s}" fill="none"/>`);
  g.push(`<path d="M${cx - 70 * s} ${cy - 20 * s} h${30 * s} M${cx - 70 * s} ${cy - 8 * s} h${30 * s} M${cx + 20 * s} ${cy - 20 * s} h${30 * s} M${cx + 20 * s} ${cy - 8 * s} h${30 * s}" fill="none" stroke-width="${3 * s}"/>`);
  g.push(`<circle cx="${cx - 10 * s}" cy="${cy - 30 * s}" r="${64 * s}" fill="rgba(180,230,255,0.4)"/>`);
  g.push('</g>');
  return g.join('');
}

function rocket(cx, cy, s, color = '#e63946') {
  return `<g stroke="#111" stroke-width="${5 * s}" stroke-linejoin="round">
    <polygon points="${cx - 40 * s},${cy + 80 * s} ${cx - 70 * s},${cy + 130 * s} ${cx - 40 * s},${cy + 120 * s}" fill="#ffb703"/>
    <polygon points="${cx + 40 * s},${cy + 80 * s} ${cx + 70 * s},${cy + 130 * s} ${cx + 40 * s},${cy + 120 * s}" fill="#ffb703"/>
    <path d="M${cx} ${cy - 130 * s} C${cx + 60 * s} ${cy - 60 * s} ${cx + 50 * s} ${cy + 60 * s} ${cx + 40 * s} ${cy + 120 * s} H${cx - 40 * s} C${cx - 50 * s} ${cy + 60 * s} ${cx - 60 * s} ${cy - 60 * s} ${cx} ${cy - 130 * s} Z" fill="${color}"/>
    <circle cx="${cx}" cy="${cy - 20 * s}" r="${24 * s}" fill="#8ecae6"/>
    <path d="M${cx - 30 * s} ${cy + 120 * s} q${30 * s} ${90 * s} ${60 * s} 0 z" fill="#ff7b00" stroke="#111"/>
    <path d="M${cx - 15 * s} ${cy + 120 * s} q${15 * s} ${50 * s} ${30 * s} 0 z" fill="#ffd166" stroke="none"/>
  </g>`;
}

function planet(cx, cy, r, color, ring = false) {
  return `<g stroke="#111" stroke-width="5">
    ${ring ? `<ellipse cx="${cx}" cy="${cy}" rx="${r * 1.7}" ry="${r * 0.45}" fill="none" stroke="#f1c453" stroke-width="14"/>` : ''}
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="${color}"/>
    <ellipse cx="${cx - r * 0.3}" cy="${cy - r * 0.3}" rx="${r * 0.3}" ry="${r * 0.18}" fill="rgba(255,255,255,0.4)" stroke="none"/>
    ${ring ? `<path d="M${cx - r * 1.7} ${cy} a${r * 1.7} ${r * 0.45} 0 0 0 ${r * 3.4} 0" fill="none" stroke="#f1c453" stroke-width="14"/><path d="M${cx - r * 1.7} ${cy} a${r * 1.7} ${r * 0.45} 0 0 0 ${r * 3.4} 0" fill="none"/>` : ''}
  </g>`;
}

function castle(x, y, w, h) {
  const tw = w / 5;
  let s = `<g stroke="#111" stroke-width="5" stroke-linejoin="round"><rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#adb5bd"/>`;
  for (let i = 0; i < 5; i += 2) s += `<rect x="${x + i * tw}" y="${y - 40}" width="${tw}" height="40" fill="#adb5bd"/>`;
  s += `<rect x="${x + w / 2 - 50}" y="${y + h - 120}" width="100" height="120" rx="50" fill="#6c4a2f"/>`;
  s += `<rect x="${x + 30}" y="${y + 40}" width="30" height="50" fill="#222"/><rect x="${x + w - 60}" y="${y + 40}" width="30" height="50" fill="#222"/></g>`;
  return s;
}

function buildings(x0, y0, w, h, rnd, color = '#5c677d') {
  let s = '<g stroke="#111" stroke-width="5">';
  let x = x0;
  while (x < x0 + w) {
    const bw = 60 + rnd() * 90;
    const bh = h * (0.35 + rnd() * 0.65);
    s += `<rect x="${x}" y="${y0 + h - bh}" width="${Math.min(bw, x0 + w - x)}" height="${bh}" fill="${color}"/>`;
    for (let wy = y0 + h - bh + 20; wy < y0 + h - 30; wy += 36) {
      for (let wx = x + 12; wx < Math.min(x + bw, x0 + w) - 20; wx += 30) {
        s += `<rect x="${wx}" y="${wy}" width="14" height="18" fill="${rnd() > 0.4 ? '#ffe066' : '#1d2433'}" stroke="none"/>`;
      }
    }
    x += bw;
  }
  return s + '</g>';
}

// ---------- panel/page composition ----------
// A panel = { x,y,w,h } in page coords, drawn with a clip, border and gutter.
function layout(kind) {
  const m = 60; // page margin
  const g = 28; // gutter
  const iw = W - 2 * m;
  const ih = H - 2 * m;
  switch (kind) {
    case 'full':
      return [{ x: m, y: m, w: iw, h: ih }];
    case 'two-rows':
      return [
        { x: m, y: m, w: iw, h: (ih - g) / 2 },
        { x: m, y: m + (ih + g) / 2, w: iw, h: (ih - g) / 2 },
      ];
    case 'three':
      return [
        { x: m, y: m, w: iw, h: ih * 0.5 },
        { x: m, y: m + ih * 0.5 + g, w: (iw - g) / 2, h: ih * 0.5 - g },
        { x: m + (iw + g) / 2, y: m + ih * 0.5 + g, w: (iw - g) / 2, h: ih * 0.5 - g },
      ];
    case 'three-top':
      return [
        { x: m, y: m, w: (iw - g) / 2, h: ih * 0.45 },
        { x: m + (iw + g) / 2, y: m, w: (iw - g) / 2, h: ih * 0.45 },
        { x: m, y: m + ih * 0.45 + g, w: iw, h: ih * 0.55 - g },
      ];
    case 'four':
      return [
        { x: m, y: m, w: (iw - g) / 2, h: (ih - g) / 2 },
        { x: m + (iw + g) / 2, y: m, w: (iw - g) / 2, h: (ih - g) / 2 },
        { x: m, y: m + (ih + g) / 2, w: (iw - g) / 2, h: (ih - g) / 2 },
        { x: m + (iw + g) / 2, y: m + (ih + g) / 2, w: (iw - g) / 2, h: (ih - g) / 2 },
      ];
    default:
      throw new Error('unknown layout ' + kind);
  }
}

function page({ seed, layoutKind, panels, pageNo, total, title }) {
  const rnd = rng(seed);
  const boxes = layout(layoutKind);
  const defs = [halftone('ht-dark', 'rgba(0,0,0,0.18)'), halftone('ht-light', 'rgba(255,255,255,0.35)', 2.5, 12)];
  let body = `<rect width="${W}" height="${H}" fill="#fdf6e3"/>`;
  // subtle paper grain
  body += `<rect width="${W}" height="${H}" fill="url(#ht-light)" opacity="0.5"/>`;
  boxes.forEach((b, i) => {
    const p = panels[i];
    if (!p) return;
    const clipId = `clip${i}`;
    defs.push(`<clipPath id="${clipId}"><rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}"/></clipPath>`);
    body += `<g clip-path="url(#${clipId})">`;
    body += p.draw(b, rnd);
    body += `<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" fill="url(#ht-dark)" opacity="0.35" style="mix-blend-mode:multiply"/>`;
    body += '</g>';
    body += `<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" fill="none" stroke="#111" stroke-width="8"/>`;
  });
  // page footer
  body += `<text x="${W / 2}" y="${H - 18}" text-anchor="middle" font-family="Georgia,serif" font-size="22" fill="#555">${esc(title)} · ${pageNo} / ${total}</text>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><defs>${defs.join('')}</defs>${body}</svg>`;
}

// background helpers used inside panels
const sky = (b, from, to) => `<linearGradient id="g${b.x}${b.y}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient><rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" fill="url(#g${b.x}${b.y})"/>`;
const stars = (b, rnd, n = 40) => Array.from({ length: n }, () => `<circle cx="${b.x + rnd() * b.w}" cy="${b.y + rnd() * b.h}" r="${1 + rnd() * 3}" fill="#fff"/>`).join('');
const ground = (b, color, frac = 0.3) => `<rect x="${b.x}" y="${b.y + b.h * (1 - frac)}" width="${b.w}" height="${b.h * frac}" fill="${color}" stroke="#111" stroke-width="5"/>`;
const speedlines = (b, cx, cy, rnd, n = 50) => `<g stroke="#111" stroke-width="3" opacity="0.6">${Array.from({ length: n }, () => { const a = rnd() * Math.PI * 2; const r1 = 120 + rnd() * 60; const r2 = r1 + 200 + rnd() * 500; return `<line x1="${cx + Math.cos(a) * r1}" y1="${cy + Math.sin(a) * r1}" x2="${cx + Math.cos(a) * r2}" y2="${cy + Math.sin(a) * r2}"/>`; }).join('')}</g>`;
const sfx = (x, y, text, color = '#ffd60a', size = 120, rot = -8) => `<g transform="rotate(${rot} ${x} ${y})"><text x="${x}" y="${y}" text-anchor="middle" font-family="Impact,'Arial Black',sans-serif" font-size="${size}" fill="${color}" stroke="#111" stroke-width="8" paint-order="stroke" font-weight="900">${esc(text)}</text></g>`;

function cover({ title, subtitle, issue, bg, art }) {
  const rnd = rng(7);
  const b = { x: 0, y: 0, w: W, h: H };
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>${halftone('ht', 'rgba(0,0,0,0.2)', 4, 16)}${sky(b, bg[0], bg[1])}</defs>
  <rect width="${W}" height="${H}" fill="url(#g00)"/>
  ${art(b, rnd)}
  <rect width="${W}" height="${H}" fill="url(#ht)" opacity="0.35" style="mix-blend-mode:multiply"/>
  <rect x="40" y="40" width="${W - 80}" height="${H - 80}" fill="none" stroke="#111" stroke-width="14"/>
  <g transform="rotate(-4 ${W / 2} 220)">
    <text x="${W / 2}" y="250" text-anchor="middle" font-family="Impact,'Arial Black',sans-serif" font-size="150" fill="#ffd60a" stroke="#111" stroke-width="14" paint-order="stroke" font-weight="900">${esc(title)}</text>
  </g>
  <text x="${W / 2}" y="340" text-anchor="middle" font-family="Georgia,serif" font-style="italic" font-size="48" fill="#fff" stroke="#111" stroke-width="8" paint-order="stroke">${esc(subtitle)}</text>
  <g transform="rotate(12 1040 180)"><circle cx="1040" cy="180" r="90" fill="#e63946" stroke="#111" stroke-width="8"/>
  <text x="1040" y="170" text-anchor="middle" font-family="Impact,sans-serif" font-size="34" fill="#fff">ISSUE</text>
  <text x="1040" y="225" text-anchor="middle" font-family="Impact,sans-serif" font-size="64" fill="#fff">#${issue}</text></g>
  <rect x="80" y="${H - 160}" width="420" height="70" fill="#fff" stroke="#111" stroke-width="6"/>
  <text x="290" y="${H - 112}" text-anchor="middle" font-family="Impact,sans-serif" font-size="40" fill="#111">COMICBOOKS PRESS</text>
</svg>`;
}

// ---------- the books ----------
const books = [];

// Book 1: Astro Cat ---------------------------------------------------
{
  const title = 'Astro Cat';
  const total = 8;
  const space = (b, rnd) => `<defs>${sky(b, '#0b132b', '#1c2541')}</defs><rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" fill="url(#g${b.x}${b.y})"/>${stars(b, rnd)}`;
  const pages = [
    { layout: 'full', panels: [{ draw: (b, r) => space(b, r) + planet(b.x + b.w * 0.75, b.y + b.h * 0.3, 140, '#f4a261', true) + rocket(b.x + b.w * 0.35, b.y + b.h * 0.55, 1.6) + caption(b.x + 30, b.y + 30, 700, 'Somewhere past the moon, a small rocket hummed along.') + bubble(b.x + 80, b.y + b.h - 420, 420, ['Mrrrow. Are we', 'there yet?'], { tailX: b.x + 300 }) }] },
    { layout: 'two-rows', panels: [
      { draw: (b, r) => space(b, r) + cat(b.x + b.w * 0.3, b.y + b.h * 0.6, 1.4) + bubble(b.x + b.w * 0.5, b.y + 60, 460, ['Mission Control,', 'this is Astro Cat.']) },
      { draw: (b, r) => `<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" fill="#2d6a4f"/>` + character(b.x + b.w * 0.3, b.y + b.h * 0.55, 1.2, { body: '#52b788', hat: 'cap' }) + bubble(b.x + b.w * 0.5, b.y + 60, 480, ['Copy, Astro Cat.', 'Status report?']) + `<rect x="${b.x + b.w * 0.6}" y="${b.y + b.h * 0.45}" width="${b.w * 0.35}" height="${b.h * 0.4}" fill="#111" stroke="#111" stroke-width="5"/><text x="${b.x + b.w * 0.775}" y="${b.y + b.h * 0.68}" text-anchor="middle" font-family="monospace" font-size="36" fill="#3bd16f">SIGNAL OK</text>` },
    ] },
    { layout: 'three', panels: [
      { draw: (b, r) => space(b, r) + speedlines(b, b.x + b.w / 2, b.y + b.h / 2, r) + sfx(b.x + b.w / 2, b.y + b.h / 2 + 40, 'KLONK!', '#ff5d5d', 160) },
      { draw: (b, r) => space(b, r) + cat(b.x + b.w * 0.5, b.y + b.h * 0.55, 1.1) + bubble(b.x + 30, b.y + 40, 380, ['Uh oh.']) },
      { draw: (b, r) => space(b, r) + `<g stroke="#111" stroke-width="6"><circle cx="${b.x + b.w * 0.5}" cy="${b.y + b.h * 0.5}" r="90" fill="#6c757d"/><circle cx="${b.x + b.w * 0.45}" cy="${b.y + b.h * 0.45}" r="22" fill="#495057"/><circle cx="${b.x + b.w * 0.6}" cy="${b.y + b.h * 0.58}" r="16" fill="#495057"/></g>` + caption(b.x + 20, b.y + b.h - 80, b.w - 40, 'A space rock. Of course.') },
    ] },
    { layout: 'full', panels: [{ draw: (b, r) => space(b, r, 80) + planet(b.x + b.w * 0.5, b.y + b.h * 0.45, 260, '#48cae4') + cat(b.x + b.w * 0.5, b.y + b.h * 0.9, 1.6) + bubble(b.x + 60, b.y + 60, 520, ['The rocket is drifting', 'toward that planet!'], { tailX: b.x + 400 }) }] },
    { layout: 'four', panels: [
      { draw: (b, r) => sky(b, '#90e0ef', '#caf0f8').replace('<linearGradient', '<defs><linearGradient').replace('</linearGradient>', '</linearGradient></defs>') + ground(b, '#80ed99', 0.35) + cat(b.x + b.w * 0.5, b.y + b.h * 0.55, 1.0) + sfx(b.x + b.w * 0.5, b.y + 120, 'THUD', '#ffd60a', 90) },
      { draw: (b, r) => sky(b, '#90e0ef', '#caf0f8').replace('<linearGradient', '<defs><linearGradient').replace('</linearGradient>', '</linearGradient></defs>') + ground(b, '#80ed99', 0.35) + robot(b.x + b.w * 0.5, b.y + b.h * 0.55, 0.9, { color: '#cdb4db' }) + bubble(b.x + 30, b.y + 40, 380, ['Beep. Visitor', 'detected.']) },
      { draw: (b, r) => sky(b, '#90e0ef', '#caf0f8').replace('<linearGradient', '<defs><linearGradient').replace('</linearGradient>', '</linearGradient></defs>') + ground(b, '#80ed99', 0.35) + cat(b.x + b.w * 0.3, b.y + b.h * 0.6, 0.9) + robot(b.x + b.w * 0.72, b.y + b.h * 0.55, 0.8, { color: '#cdb4db' }) + bubble(b.x + 30, b.y + 40, 420, ['Do you have', 'rocket fuel?']) },
      { draw: (b, r) => sky(b, '#90e0ef', '#caf0f8').replace('<linearGradient', '<defs><linearGradient').replace('</linearGradient>', '</linearGradient></defs>') + ground(b, '#80ed99', 0.35) + robot(b.x + b.w * 0.5, b.y + b.h * 0.55, 0.9, { color: '#cdb4db', eyes: 'happy' }) + bubble(b.x + 30, b.y + 40, 440, ['We have fish-', 'flavoured fuel.']) },
    ] },
    { layout: 'three-top', panels: [
      { draw: (b, r) => sky(b, '#90e0ef', '#caf0f8').replace('<linearGradient', '<defs><linearGradient').replace('</linearGradient>', '</linearGradient></defs>') + ground(b, '#80ed99', 0.35) + cat(b.x + b.w * 0.5, b.y + b.h * 0.55, 1.0) + bubble(b.x + 30, b.y + 40, 400, ['Purrrfect.']) },
      { draw: (b, r) => sky(b, '#90e0ef', '#caf0f8').replace('<linearGradient', '<defs><linearGradient').replace('</linearGradient>', '</linearGradient></defs>') + ground(b, '#80ed99', 0.35) + rocket(b.x + b.w * 0.5, b.y + b.h * 0.45, 1.0) + sfx(b.x + b.w * 0.5, b.y + b.h - 60, 'GLUG GLUG', '#48cae4', 60) },
      { draw: (b, r) => sky(b, '#ffb703', '#fb8500').replace('<linearGradient', '<defs><linearGradient').replace('</linearGradient>', '</linearGradient></defs>') + ground(b, '#80ed99', 0.25) + speedlines(b, b.x + b.w * 0.5, b.y + b.h * 0.4, r, 30) + rocket(b.x + b.w * 0.5, b.y + b.h * 0.4, 1.4) + sfx(b.x + b.w * 0.5, b.y + b.h - 80, 'WHOOOSH!', '#fff', 110) },
    ] },
    { layout: 'two-rows', panels: [
      { draw: (b, r) => space(b, r) + planet(b.x + b.w * 0.2, b.y + b.h * 0.7, 120, '#48cae4') + rocket(b.x + b.w * 0.7, b.y + b.h * 0.4, 1.1) + bubble(b.x + 40, b.y + 40, 520, ['Goodbye, fish-fuel', 'robots!'], { tailX: b.x + 400 }) },
      { draw: (b, r) => `<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" fill="#2d6a4f"/>` + character(b.x + b.w * 0.3, b.y + b.h * 0.55, 1.2, { body: '#52b788', hat: 'cap', pose: 'cheer' }) + bubble(b.x + b.w * 0.5, b.y + 60, 480, ['Welcome back,', 'Astro Cat!']) },
    ] },
    { layout: 'full', panels: [{ draw: (b, r) => space(b, r, 120) + planet(b.x + b.w * 0.8, b.y + b.h * 0.2, 90, '#f4a261', true) + cat(b.x + b.w * 0.5, b.y + b.h * 0.6, 2.0) + bubble(b.x + 80, b.y + 80, 560, ['Next time... I take', 'the bus.'], { tailX: b.x + 420 }) + sfx(b.x + b.w / 2, b.y + b.h - 120, 'THE END', '#ffd60a', 130, -3) }] },
  ];
  books.push({
    slug: 'astro-cat',
    yaml: { title: 'Astro Cat', subtitle: 'Lost in Orbit', author: 'Comicbooks Press', issue: 1, description: 'A small cat, a small rocket, and one very large space rock.', tags: ['space', 'cats', 'all ages'] },
    cover: () => cover({ title, subtitle: 'Lost in Orbit', issue: 1, bg: ['#0b132b', '#3a506b'], art: (b, r) => stars(b, r, 120) + planet(900, 1100, 220, '#f4a261', true) + rocket(300, 1000, 2.2) + cat(620, 1300, 1.8) }),
    pages: pages.map((p, i) => ({ file: `page-${String(i + 1).padStart(2, '0')}.png`, svg: page({ seed: 100 + i, layoutKind: p.layout, panels: p.panels, pageNo: i + 1, total, title }) })),
  });
}

// Book 2: The Pixel Knight ---------------------------------------------
{
  const title = 'Pixel Knight';
  const total = 6;
  const meadow = (b, rnd) => `<defs>${sky(b, '#8ecae6', '#e0fbfc')}</defs><rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" fill="url(#g${b.x}${b.y})"/><circle cx="${b.x + b.w * 0.85}" cy="${b.y + 110}" r="70" fill="#ffd60a" stroke="#111" stroke-width="5"/>` + ground(b, '#74c69d', 0.3);
  const night = (b, rnd) => `<defs>${sky(b, '#1b263b', '#415a77')}</defs><rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" fill="url(#g${b.x}${b.y})"/>${stars(b, rnd, 25)}` + ground(b, '#2d6a4f', 0.3);
  const dragon = (cx, cy, s, eyes = 'open') => `<g stroke="#111" stroke-width="${5 * s}" stroke-linejoin="round"><ellipse cx="${cx}" cy="${cy}" rx="${140 * s}" ry="${90 * s}" fill="#6a994e"/><path d="M${cx - 130 * s} ${cy} q${-120 * s} ${-40 * s} ${-80 * s} ${-140 * s}" fill="none" stroke-width="${22 * s}" stroke="#6a994e"/><path d="M${cx - 130 * s} ${cy} q${-120 * s} ${-40 * s} ${-80 * s} ${-140 * s}" fill="none"/><circle cx="${cx + 130 * s}" cy="${cy - 70 * s}" r="${60 * s}" fill="#6a994e"/><polygon points="${cx + 160 * s},${cy - 60 * s} ${cx + 240 * s},${cy - 40 * s} ${cx + 160 * s},${cy - 20 * s}" fill="#a7c957"/>${eyes === 'open' ? `<circle cx="${cx + 140 * s}" cy="${cy - 85 * s}" r="${12 * s}" fill="#fff"/><circle cx="${cx + 144 * s}" cy="${cy - 85 * s}" r="${5 * s}" fill="#111" stroke="none"/>` : `<path d="M${cx + 125 * s} ${cy - 85 * s} q${15 * s} ${12 * s} ${30 * s} 0" fill="none"/>`}<polygon points="${cx + 110 * s},${cy - 120 * s} ${cx + 120 * s},${cy - 170 * s} ${cx + 140 * s},${cy - 125 * s}" fill="#a7c957"/><path d="M${cx - 40 * s} ${cy - 80 * s} l${-30 * s} ${-110 * s} l${80 * s} ${70 * s} l${20 * s} ${-90 * s} l${30 * s} ${120 * s}" fill="#a7c957"/></g>`;
  const knight = (cx, cy, s, o = {}) => character(cx, cy, s, { body: '#9aa5b1', hat: 'knight', ...o }) + `<g stroke="#111" stroke-width="${5 * s}"><rect x="${cx + 90 * s}" y="${cy - 90 * s}" width="${14 * s}" height="${150 * s}" fill="#dee2e6"/><rect x="${cx + 70 * s}" y="${cy + 50 * s}" width="${54 * s}" height="${14 * s}" fill="#b5651d"/></g>`;
  const pages = [
    { layout: 'full', panels: [{ draw: (b, r) => meadow(b, r) + castle(b.x + b.w * 0.55, b.y + b.h * 0.42, 420, 300) + knight(b.x + b.w * 0.3, b.y + b.h * 0.6, 1.5) + caption(b.x + 30, b.y + 30, 760, 'Sir Pix set out at dawn to find the dragon of Gloomy Hill.') + bubble(b.x + 60, b.y + b.h - 480, 440, ['A knight\'s work', 'is never done.'], { tailX: b.x + 260 }) }] },
    { layout: 'three-top', panels: [
      { draw: (b, r) => meadow(b, r) + knight(b.x + b.w * 0.5, b.y + b.h * 0.55, 1.0, { pose: 'run' }) + sfx(b.x + b.w * 0.5, b.y + 110, 'CLANK', '#dee2e6', 80) },
      { draw: (b, r) => meadow(b, r) + knight(b.x + b.w * 0.5, b.y + b.h * 0.55, 1.0, { pose: 'run' }) + sfx(b.x + b.w * 0.5, b.y + 110, 'CLANK', '#dee2e6', 80, 6) },
      { draw: (b, r) => night(b, r) + `<path d="M${b.x} ${b.y + b.h * 0.7} q${b.w * 0.5} ${-b.h * 0.6} ${b.w} 0 z" fill="#1b4332" stroke="#111" stroke-width="5"/>` + knight(b.x + b.w * 0.2, b.y + b.h * 0.6, 1.0) + bubble(b.x + b.w * 0.4, b.y + 60, 460, ['Gloomy Hill.', 'Very gloomy.']) },
    ] },
    { layout: 'two-rows', panels: [
      { draw: (b, r) => night(b, r) + dragon(b.x + b.w * 0.55, b.y + b.h * 0.6, 1.2) + bubble(b.x + 40, b.y + 40, 460, ['...zzz...', '...snrrrk...']) },
      { draw: (b, r) => night(b, r) + knight(b.x + b.w * 0.25, b.y + b.h * 0.55, 1.1, { eyes: 'wide' }) + bubble(b.x + b.w * 0.45, b.y + 60, 480, ['It\'s... asleep?', 'Nobody said it', 'would be asleep.']) },
    ] },
    { layout: 'four', panels: [
      { draw: (b, r) => night(b, r) + knight(b.x + b.w * 0.5, b.y + b.h * 0.55, 0.9) + bubble(b.x + 30, b.y + 40, 400, ['Ahem.']) },
      { draw: (b, r) => night(b, r) + dragon(b.x + b.w * 0.5, b.y + b.h * 0.6, 0.8) + bubble(b.x + 30, b.y + 40, 400, ['...zzz...']) },
      { draw: (b, r) => night(b, r) + knight(b.x + b.w * 0.5, b.y + b.h * 0.55, 0.9, { pose: 'cheer' }) + bubble(b.x + 30, b.y + 40, 420, ['DRAGON!', 'WAKE UP!'], { shout: true }) },
      { draw: (b, r) => night(b, r) + speedlines(b, b.x + b.w / 2, b.y + b.h / 2, r, 30) + dragon(b.x + b.w * 0.5, b.y + b.h * 0.6, 0.8, 'open') + sfx(b.x + b.w / 2, b.y + 130, 'SNORT!', '#ff5d5d', 90) },
    ] },
    { layout: 'three', panels: [
      { draw: (b, r) => night(b, r) + dragon(b.x + b.w * 0.6, b.y + b.h * 0.6, 1.3) + knight(b.x + b.w * 0.15, b.y + b.h * 0.6, 1.0, { eyes: 'wide' }) + bubble(b.x + b.w * 0.45, b.y + 50, 560, ['You woke me up', 'for a FIGHT?'], { shout: true }) },
      { draw: (b, r) => night(b, r) + knight(b.x + b.w * 0.5, b.y + b.h * 0.55, 0.9) + bubble(b.x + 30, b.y + 40, 420, ['Well... the village', 'sent me. Technically.']) },
      { draw: (b, r) => night(b, r) + dragon(b.x + b.w * 0.5, b.y + b.h * 0.6, 0.75, 'closed') + bubble(b.x + 30, b.y + 40, 440, ['How about tea', 'instead?']) },
    ] },
    { layout: 'full', panels: [{ draw: (b, r) => `<defs>${sky(b, '#ffafcc', '#ffc8dd')}</defs><rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" fill="url(#g${b.x}${b.y})"/>` + ground(b, '#74c69d', 0.3) + dragon(b.x + b.w * 0.62, b.y + b.h * 0.6, 1.3, 'closed') + knight(b.x + b.w * 0.25, b.y + b.h * 0.6, 1.2, { eyes: 'closed' }) + `<g stroke="#111" stroke-width="5"><rect x="${b.x + b.w * 0.38}" y="${b.y + b.h * 0.66}" width="90" height="60" rx="10" fill="#fff"/><path d="M${b.x + b.w * 0.38 + 90} ${b.y + b.h * 0.66 + 15} q40 15 0 35" fill="none"/></g>` + caption(b.x + 30, b.y + 30, 820, 'And that is how Gloomy Hill got its first tea shop.') + sfx(b.x + b.w / 2, b.y + b.h - 110, 'THE END', '#ffd60a', 130, -3) }] },
  ];
  books.push({
    slug: 'pixel-knight',
    yaml: { title: 'The Pixel Knight', subtitle: 'The Dragon of Gloomy Hill', author: 'Comicbooks Press', issue: 1, description: 'Sir Pix goes to slay a dragon and comes back with a tea shop.', tags: ['fantasy', 'humour'] },
    cover: () => cover({ title, subtitle: 'The Dragon of Gloomy Hill', issue: 1, bg: ['#1b263b', '#778da9'], art: (b, r) => stars(b, r, 60) + `<path d="M0 1200 q600 -500 1200 0 v400 h-1200 z" fill="#1b4332" stroke="#111" stroke-width="8"/>` + castle(700, 650, 380, 260) + dragon(760, 1250, 1.3) + knight(300, 1250, 2.0, { pose: 'cheer' }) }),
    pages: pages.map((p, i) => ({ file: `page-${String(i + 1).padStart(2, '0')}.png`, svg: page({ seed: 200 + i, layoutKind: p.layout, panels: p.panels, pageNo: i + 1, total, title }) })),
  });
}

// Book 3: Noodle & Bolt --------------------------------------------------
// This book uses descriptive file names, so book.yaml carries the explicit order.
{
  const title = 'Noodle & Bolt';
  const total = 7;
  const city = (b, rnd, dusk = false) => `<defs>${sky(b, dusk ? '#f72585' : '#4cc9f0', dusk ? '#7209b7' : '#f8f9fa')}</defs><rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" fill="url(#g${b.x}${b.y})"/>` + buildings(b.x - 20, b.y, b.w + 40, b.h * 0.72, rnd, dusk ? '#3a0ca3' : '#5c677d') + ground(b, '#6c757d', 0.28);
  const noodle = (cx, cy, s, o = {}) => character(cx, cy, s, { body: '#ff9f1c', skin: '#ffe8d6', antenna: true, ...o });
  const bolt = (cx, cy, s, o = {}) => robot(cx, cy, s, { color: '#4ea8de', ...o });
  const pages = [
    { name: 'morning-commute', layout: 'full', panels: [{ draw: (b, r) => city(b, r) + noodle(b.x + b.w * 0.3, b.y + b.h * 0.62, 1.4, { pose: 'wave' }) + bolt(b.x + b.w * 0.68, b.y + b.h * 0.6, 1.3) + caption(b.x + 30, b.y + 30, 720, 'Every morning, Noodle and Bolt walked to the Gadget Works.') + bubble(b.x + 80, b.y + b.h - 520, 400, ['Morning, Bolt!'], { tailX: b.x + 260 }) + bubble(b.x + b.w * 0.5, b.y + b.h - 420, 420, ['Good morning,', 'Noodle. 7:02.'], { tailX: b.x + b.w * 0.7 }) }] },
    { name: 'the-package', layout: 'two-rows', panels: [
      { draw: (b, r) => city(b, r) + `<g stroke="#111" stroke-width="6"><rect x="${b.x + b.w * 0.4}" y="${b.y + b.h * 0.5}" width="240" height="200" fill="#c68b59"/><line x1="${b.x + b.w * 0.4 + 120}" y1="${b.y + b.h * 0.5}" x2="${b.x + b.w * 0.4 + 120}" y2="${b.y + b.h * 0.5 + 200}"/><text x="${b.x + b.w * 0.4 + 120}" y="${b.y + b.h * 0.5 + 120}" text-anchor="middle" font-family="Impact" font-size="40" fill="#111">?</text></g>` + caption(b.x + 20, b.y + 20, 520, 'A mysterious box sat on the doorstep.') },
      { draw: (b, r) => city(b, r) + noodle(b.x + b.w * 0.3, b.y + b.h * 0.6, 1.1, { eyes: 'wide' }) + bolt(b.x + b.w * 0.7, b.y + b.h * 0.58, 1.0) + bubble(b.x + 40, b.y + 50, 440, ['No label. No', 'return address.']) + bubble(b.x + b.w * 0.55, b.y + b.h * 0.08, 400, ['Suspicious.']) },
    ] },
    { name: 'opening-it', layout: 'four', panels: [
      { draw: (b, r) => `<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" fill="#ffe66d"/>` + noodle(b.x + b.w * 0.5, b.y + b.h * 0.55, 0.9) + bubble(b.x + 30, b.y + 40, 400, ['I\'m opening it.']) },
      { draw: (b, r) => `<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" fill="#ffe66d"/>` + bolt(b.x + b.w * 0.5, b.y + b.h * 0.55, 0.85) + bubble(b.x + 30, b.y + 40, 420, ['Probability of', 'danger: 38%.']) },
      { draw: (b, r) => `<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" fill="#ffe66d"/>` + speedlines(b, b.x + b.w / 2, b.y + b.h / 2, r, 40) + sfx(b.x + b.w / 2, b.y + b.h / 2 + 40, 'RRRIP', '#ff5d5d', 130) },
      { draw: (b, r) => `<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" fill="#ffe66d"/>` + `<g stroke="#111" stroke-width="5"><circle cx="${b.x + b.w * 0.5}" cy="${b.y + b.h * 0.55}" r="80" fill="#e5383b"/><ellipse cx="${b.x + b.w * 0.5}" cy="${b.y + b.h * 0.55 - 50}" rx="60" ry="24" fill="#9d0208"/><rect x="${b.x + b.w * 0.5 - 8}" y="${b.y + b.h * 0.55 - 130}" width="16" height="70" fill="#6a994e"/></g>` + bubble(b.x + 30, b.y + 40, 420, ['...a tomato?']) },
    ] },
    { name: 'the-note', layout: 'three', panels: [
      { draw: (b, r) => `<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" fill="#f1faee"/><g transform="rotate(-3 ${b.x + b.w / 2} ${b.y + b.h / 2})"><rect x="${b.x + b.w * 0.2}" y="${b.y + b.h * 0.15}" width="${b.w * 0.6}" height="${b.h * 0.7}" fill="#fff" stroke="#111" stroke-width="5"/><text x="${b.x + b.w / 2}" y="${b.y + b.h * 0.4}" text-anchor="middle" font-family="'Comic Sans MS',cursive" font-size="44" fill="#111">Grow me.</text><text x="${b.x + b.w / 2}" y="${b.y + b.h * 0.55}" text-anchor="middle" font-family="'Comic Sans MS',cursive" font-size="44" fill="#111">Share me.</text><text x="${b.x + b.w / 2}" y="${b.y + b.h * 0.7}" text-anchor="middle" font-family="'Comic Sans MS',cursive" font-size="30" fill="#555">- a friend</text></g>` },
      { draw: (b, r) => city(b, r) + noodle(b.x + b.w * 0.5, b.y + b.h * 0.6, 0.9, { eyes: 'closed' }) + bubble(b.x + 30, b.y + 40, 440, ['Bolt, do we own', 'a garden?']) },
      { draw: (b, r) => city(b, r) + bolt(b.x + b.w * 0.5, b.y + b.h * 0.58, 0.9) + bubble(b.x + 30, b.y + 40, 440, ['We own a roof.', 'Close enough.']) },
    ] },
    { name: 'rooftop', layout: 'full', panels: [{ draw: (b, r) => city(b, r, true) + `<rect x="${b.x}" y="${b.y + b.h * 0.6}" width="${b.w}" height="${b.h * 0.4}" fill="#495057" stroke="#111" stroke-width="6"/>` + Array.from({ length: 6 }, (_, i) => `<g stroke="#111" stroke-width="5"><rect x="${b.x + 80 + i * 170}" y="${b.y + b.h * 0.6 - 40}" width="120" height="90" fill="#b5651d"/><path d="M${b.x + 140 + i * 170} ${b.y + b.h * 0.6 - 40} v-80 m-30 30 q30 -40 60 0" fill="none" stroke="#6a994e" stroke-width="8"/></g>`).join('') + noodle(b.x + b.w * 0.25, b.y + b.h * 0.42, 1.2, { pose: 'cheer' }) + bolt(b.x + b.w * 0.72, b.y + b.h * 0.4, 1.1, { eyes: 'happy' }) + caption(b.x + 30, b.y + 30, 640, 'Three weeks later, the roof was not a roof anymore.') }] },
    { name: 'harvest', layout: 'two-rows', panels: [
      { draw: (b, r) => city(b, r, true) + noodle(b.x + b.w * 0.3, b.y + b.h * 0.6, 1.1) + Array.from({ length: 5 }, (_, i) => `<circle cx="${b.x + b.w * 0.55 + i * 70}" cy="${b.y + b.h * 0.68}" r="30" fill="#e5383b" stroke="#111" stroke-width="5"/>`).join('') + bubble(b.x + 40, b.y + 50, 460, ['That\'s a LOT', 'of tomatoes.']) },
      { draw: (b, r) => city(b, r, true) + bolt(b.x + b.w * 0.3, b.y + b.h * 0.58, 1.0) + noodle(b.x + b.w * 0.7, b.y + b.h * 0.6, 1.0, { pose: 'wave' }) + bubble(b.x + 40, b.y + 50, 500, ['The note said', '"share me".']) + bubble(b.x + b.w * 0.55, b.y + b.h * 0.1, 400, ['Soup party!']) },
    ] },
    { name: 'the-end', layout: 'full', panels: [{ draw: (b, r) => city(b, r, true) + `<rect x="${b.x}" y="${b.y + b.h * 0.6}" width="${b.w}" height="${b.h * 0.4}" fill="#495057" stroke="#111" stroke-width="6"/>` + noodle(b.x + b.w * 0.22, b.y + b.h * 0.42, 1.1, { pose: 'cheer' }) + bolt(b.x + b.w * 0.5, b.y + b.h * 0.4, 1.0, { eyes: 'happy' }) + character(b.x + b.w * 0.78, b.y + b.h * 0.42, 1.1, { body: '#52b788', hat: 'cap', pose: 'wave' }) + `<g stroke="#111" stroke-width="6"><ellipse cx="${b.x + b.w * 0.5}" cy="${b.y + b.h * 0.72}" rx="200" ry="40" fill="#e5383b"/><rect x="${b.x + b.w * 0.5 - 200}" y="${b.y + b.h * 0.72}" width="400" height="100" fill="#adb5bd"/></g>` + caption(b.x + 30, b.y + 30, 560, 'Nobody ever found out who sent the box.') + sfx(b.x + b.w / 2, b.y + b.h - 110, 'THE END', '#ffd60a', 130, -3) }] },
  ];
  books.push({
    slug: 'noodle-and-bolt',
    yaml: { title: 'Noodle & Bolt', subtitle: 'The Mysterious Box', author: 'Comicbooks Press', issue: 3, description: 'A robot, a kid, and a box with no return address.', tags: ['robots', 'city', 'friendship'] },
    explicitOrder: true,
    cover: () => cover({ title, subtitle: 'The Mysterious Box', issue: 3, bg: ['#f72585', '#7209b7'], art: (b, r) => buildings(-20, 500, W + 40, 700, r, '#3a0ca3') + `<rect x="0" y="1200" width="${W}" height="400" fill="#495057" stroke="#111" stroke-width="8"/>` + noodle(380, 1100, 2.0, { pose: 'cheer' }) + bolt(820, 1080, 1.9) }),
    pages: pages.map((p, i) => ({ file: `${p.name}.png`, caption: p.name.replace(/-/g, ' '), svg: page({ seed: 300 + i, layoutKind: p.layout, panels: p.panels, pageNo: i + 1, total, title }) })),
  });
}

// ---------- write everything ----------
function toYaml(book) {
  const y = book.yaml;
  const lines = [
    '# Comic book manifest. One folder = one book.',
    `title: ${JSON.stringify(y.title)}`,
    `subtitle: ${JSON.stringify(y.subtitle)}`,
    `author: ${JSON.stringify(y.author)}`,
    `issue: ${y.issue}`,
    `description: ${JSON.stringify(y.description)}`,
    `tags: [${y.tags.join(', ')}]`,
    'cover: cover.png',
    `direction: ltr   # reading direction: ltr or rtl (manga)`,
  ];
  if (book.explicitOrder) {
    lines.push('# Explicit page order. Each entry may be a file name or a { file, caption } object.');
    lines.push('pages:');
    for (const p of book.pages) {
      lines.push(`  - file: ${p.file}`);
      if (p.caption) lines.push(`    caption: ${JSON.stringify(p.caption)}`);
    }
  } else {
    lines.push('# No "pages" list: every image in the folder (except the cover) is used,');
    lines.push('# sorted by file name.');
  }
  return lines.join('\n') + '\n';
}

await rm(OUT, { recursive: true, force: true });
for (const book of books) {
  const dir = path.join(OUT, book.slug);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, 'book.yaml'), toYaml(book));
  await sharp(Buffer.from(book.cover())).png({ compressionLevel: 9, palette: true }).toFile(path.join(dir, 'cover.png'));
  for (const p of book.pages) {
    await sharp(Buffer.from(p.svg)).png({ compressionLevel: 9, palette: true }).toFile(path.join(dir, p.file));
  }
  console.log(`✔ ${book.slug}: cover + ${book.pages.length} pages`);
}
