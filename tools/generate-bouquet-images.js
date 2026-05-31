const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const outDir = path.join(__dirname, "..", "server", "public", "bouquets");
const WIDTH = 320;
const HEIGHT = 320;

const scenarios = [
  { id: "birthday", accent: "#f5b84b" },
  { id: "love", accent: "#d94d67" },
  { id: "anniversary", accent: "#9b7bd3" },
  { id: "visit", accent: "#7bbf90" }
];
const flowers = [
  { id: "rose" },
  { id: "tulip" },
  { id: "lisianthus" },
  { id: "sunflower" }
];
const palettes = [
  { id: "pink", colors: ["#e98ba2", "#fff0f4", "#b996dc"], wrapColor: "#f5e2e7", ribbonColor: "#c96078" },
  { id: "champagne", colors: ["#d6ad70", "#fff1cf", "#e9bc9c"], wrapColor: "#eadcc7", ribbonColor: "#94704c" },
  { id: "red", colors: ["#be333d", "#f1d3d6", "#262626"], wrapColor: "#3c3534", ribbonColor: "#c7383f" },
  { id: "fresh", colors: ["#f7ae31", "#ffe78a", "#f07935"], wrapColor: "#fff0cd", ribbonColor: "#d46b08" }
];
const layouts = [
  { id: "round" },
  { id: "natural" },
  { id: "side" }
];
const wrappers = [
  { id: "korean" },
  { id: "kraft" },
  { id: "mesh" },
  { id: "premium" }
];

const layoutMap = {
  round: [[48, 20, 38], [34, 28, 30], [62, 30, 30], [42, 40, 30], [56, 42, 30], [48, 52, 38], [30, 48, 24], [68, 50, 24], [38, 60, 24], [58, 62, 24]],
  natural: [[50, 14, 30], [35, 24, 38], [63, 28, 24], [44, 38, 30], [58, 44, 38], [29, 48, 24], [48, 56, 30], [68, 58, 24], [38, 66, 24]],
  side: [[38, 18, 38], [50, 25, 30], [62, 35, 30], [44, 42, 30], [56, 52, 38], [66, 62, 24], [48, 67, 24], [36, 57, 24]]
};

function seedFrom(text) {
  let seed = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    seed ^= text.charCodeAt(i);
    seed = Math.imul(seed, 16777619);
  }
  return seed >>> 0;
}

function createRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function hexToRgb(hex) {
  const value = hex.replace("#", "");
  return [
    parseInt(value.slice(0, 2), 16),
    parseInt(value.slice(2, 4), 16),
    parseInt(value.slice(4, 6), 16)
  ];
}

function clamp(value) {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function shade(hex, amount) {
  const [r, g, b] = hexToRgb(hex);
  const next = [clamp(r + amount), clamp(g + amount), clamp(b + amount)];
  return `#${next.map((item) => item.toString(16).padStart(2, "0")).join("")}`;
}

function mix(hexA, hexB, t) {
  const a = hexToRgb(hexA);
  const b = hexToRgb(hexB);
  const next = a.map((value, index) => clamp(value + (b[index] - value) * t));
  return `#${next.map((item) => item.toString(16).padStart(2, "0")).join("")}`;
}

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i += 1) {
    c ^= buf[i];
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
  }
  return ~c >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type);
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([len, typeBuf, data, crc]);
}

function blendPixel(buf, width, height, x, y, hex, alpha = 1) {
  if (x < 0 || y < 0 || x >= width || y >= height) return;
  const rgb = Array.isArray(hex) ? hex : hexToRgb(hex);
  const index = (Math.round(y) * width + Math.round(x)) * 4;
  const inv = 1 - alpha;
  buf[index] = clamp(rgb[0] * alpha + buf[index] * inv);
  buf[index + 1] = clamp(rgb[1] * alpha + buf[index + 1] * inv);
  buf[index + 2] = clamp(rgb[2] * alpha + buf[index + 2] * inv);
  buf[index + 3] = 255;
}

function drawEllipse(buf, width, height, cx, cy, rx, ry, angle, color, alpha = 1) {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const radius = Math.ceil(Math.max(rx, ry));
  for (let y = Math.floor(cy - radius); y <= Math.ceil(cy + radius); y += 1) {
    for (let x = Math.floor(cx - radius); x <= Math.ceil(cx + radius); x += 1) {
      const dx = x - cx;
      const dy = y - cy;
      const tx = dx * cos + dy * sin;
      const ty = -dx * sin + dy * cos;
      const v = (tx * tx) / (rx * rx) + (ty * ty) / (ry * ry);
      if (v <= 1) {
        const edge = Math.max(0.22, 1 - v * 0.58);
        blendPixel(buf, width, height, x, y, color, alpha * edge);
      }
    }
  }
}

function drawCircle(buf, width, height, cx, cy, r, color, alpha = 1) {
  drawEllipse(buf, width, height, cx, cy, r, r, 0, color, alpha);
}

function drawLine(buf, width, height, x1, y1, x2, y2, size, color, alpha = 1) {
  const steps = Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1));
  for (let i = 0; i <= steps; i += 1) {
    const t = steps === 0 ? 0 : i / steps;
    drawCircle(buf, width, height, x1 + (x2 - x1) * t, y1 + (y2 - y1) * t, size, color, alpha);
  }
}

function drawPolygon(buf, width, height, points, color, alpha = 1) {
  const ys = points.map((point) => point[1]);
  const minY = Math.max(0, Math.floor(Math.min(...ys)));
  const maxY = Math.min(height - 1, Math.ceil(Math.max(...ys)));
  for (let y = minY; y <= maxY; y += 1) {
    const nodes = [];
    let j = points.length - 1;
    for (let i = 0; i < points.length; i += 1) {
      const pi = points[i];
      const pj = points[j];
      if ((pi[1] < y && pj[1] >= y) || (pj[1] < y && pi[1] >= y)) {
        nodes.push(Math.floor(pi[0] + ((y - pi[1]) / (pj[1] - pi[1])) * (pj[0] - pi[0])));
      }
      j = i;
    }
    nodes.sort((a, b) => a - b);
    for (let n = 0; n < nodes.length; n += 2) {
      for (let x = nodes[n]; x < nodes[n + 1]; x += 1) blendPixel(buf, width, height, x, y, color, alpha);
    }
  }
}

function png(width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (width * 4 + 1)] = 0;
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0))
  ]);
}

function drawBackground(buf, rand) {
  for (let y = 0; y < HEIGHT; y += 1) {
    for (let x = 0; x < WIDTH; x += 1) {
      const distance = Math.hypot(x - WIDTH / 2, y - HEIGHT / 2) / 226;
      const warm = clamp(252 - distance * 12);
      const index = (y * WIDTH + x) * 4;
      buf[index] = warm;
      buf[index + 1] = clamp(warm - 3);
      buf[index + 2] = clamp(warm - 8);
      buf[index + 3] = 255;
    }
  }
  drawEllipse(buf, WIDTH, HEIGHT, 160, 210, 104, 35, 0, "#d8cec2", 0.28);
  drawEllipse(buf, WIDTH, HEIGHT, 160, 126, 118, 104, 0, "#ffffff", 0.72);
}

function drawWrapper(buf, palette, wrapper, scenario) {
  const wrap = palette.wrapColor;
  drawPolygon(buf, WIDTH, HEIGHT, [[86, 178], [164, 128], [155, 286], [103, 300]], shade(wrap, -10), 0.95);
  drawPolygon(buf, WIDTH, HEIGHT, [[234, 178], [156, 128], [165, 286], [217, 300]], shade(wrap, -4), 0.95);
  drawPolygon(buf, WIDTH, HEIGHT, [[96, 192], [224, 192], [203, 300], [117, 300]], wrap, 0.96);
  drawPolygon(buf, WIDTH, HEIGHT, [[112, 202], [208, 202], [193, 284], [127, 284]], mix(wrap, "#ffffff", 0.34), 0.75);

  if (wrapper.id === "kraft") {
    drawPolygon(buf, WIDTH, HEIGHT, [[102, 194], [218, 194], [202, 226], [118, 226]], "#c79a63", 0.68);
    for (let i = 0; i < 160; i += 1) {
      const x = 96 + (i * 29) % 126;
      const y = 190 + (i * 17) % 100;
      blendPixel(buf, WIDTH, HEIGHT, x, y, "#9d774e", 0.16);
    }
  }
  if (wrapper.id === "mesh") {
    for (let x = 88; x < 232; x += 16) drawLine(buf, WIDTH, HEIGHT, x, 186, x + 34, 298, 0.8, "#ffffff", 0.28);
    for (let x = 232; x > 88; x -= 16) drawLine(buf, WIDTH, HEIGHT, x, 186, x - 34, 298, 0.8, "#ffffff", 0.22);
  }
  if (wrapper.id === "premium") {
    drawPolygon(buf, WIDTH, HEIGHT, [[108, 182], [226, 198], [208, 232], [118, 216]], "#ffffff", 0.78);
    drawLine(buf, WIDTH, HEIGHT, 112, 185, 218, 201, 1.1, "#d8d1c9", 0.36);
  }
  if (wrapper.id === "korean") {
    drawEllipse(buf, WIDTH, HEIGHT, 105, 198, 28, 10, -0.75, "#ffffff", 0.22);
    drawEllipse(buf, WIDTH, HEIGHT, 215, 198, 28, 10, 0.75, "#ffffff", 0.18);
  }
  drawPolygon(buf, WIDTH, HEIGHT, [[120, 236], [200, 236], [193, 255], [127, 255]], palette.ribbonColor, 0.95);
  drawEllipse(buf, WIDTH, HEIGHT, 160, 245, 18, 10, 0, scenario.accent, 0.62);
}

function drawLeaf(buf, cx, cy, size, angle, color = "#4f8f61") {
  drawEllipse(buf, WIDTH, HEIGHT, cx, cy, size * 1.4, size * 0.45, angle, color, 0.78);
  drawLine(
    buf,
    WIDTH,
    HEIGHT,
    cx - Math.cos(angle) * size * 0.75,
    cy - Math.sin(angle) * size * 0.75,
    cx + Math.cos(angle) * size * 0.75,
    cy + Math.sin(angle) * size * 0.75,
    0.45,
    shade(color, -24),
    0.42
  );
}

function flowerColor(flower, palette, index) {
  if (flower.id === "sunflower") return index % 3 === 0 ? "#f2b63a" : "#ffd36b";
  return palette.colors[index % palette.colors.length];
}

function drawRose(buf, cx, cy, size, base, rand) {
  for (let layer = 0; layer < 3; layer += 1) {
    const petals = 9 - layer * 2;
    const radius = size * (0.72 - layer * 0.17);
    for (let i = 0; i < petals; i += 1) {
      const a = (Math.PI * 2 * i) / petals + layer * 0.42;
      const px = cx + Math.cos(a) * radius * 0.34;
      const py = cy + Math.sin(a) * radius * 0.24;
      drawEllipse(buf, WIDTH, HEIGHT, px, py, size * (0.42 - layer * 0.05), size * 0.22, a, shade(base, layer * -18 + rand() * 8), 0.9);
    }
  }
  drawCircle(buf, WIDTH, HEIGHT, cx, cy, size * 0.22, shade(base, -34), 0.95);
  drawEllipse(buf, WIDTH, HEIGHT, cx + size * 0.08, cy - size * 0.02, size * 0.18, size * 0.08, -0.6, mix(base, "#ffffff", 0.18), 0.78);
}

function drawTulip(buf, cx, cy, size, base) {
  drawEllipse(buf, WIDTH, HEIGHT, cx, cy, size * 0.44, size * 0.82, 0, shade(base, -10), 0.9);
  drawEllipse(buf, WIDTH, HEIGHT, cx - size * 0.32, cy + size * 0.04, size * 0.34, size * 0.68, -0.36, base, 0.86);
  drawEllipse(buf, WIDTH, HEIGHT, cx + size * 0.32, cy + size * 0.04, size * 0.34, size * 0.68, 0.36, shade(base, 14), 0.86);
  drawEllipse(buf, WIDTH, HEIGHT, cx, cy - size * 0.28, size * 0.26, size * 0.48, 0.08, mix(base, "#ffffff", 0.16), 0.72);
}

function drawLisianthus(buf, cx, cy, size, base, rand) {
  for (let i = 0; i < 12; i += 1) {
    const a = (Math.PI * 2 * i) / 12;
    const petalColor = i % 2 === 0 ? mix(base, "#ffffff", 0.18) : shade(base, -12);
    drawEllipse(buf, WIDTH, HEIGHT, cx + Math.cos(a) * size * 0.28, cy + Math.sin(a) * size * 0.2, size * 0.42, size * 0.19, a + rand() * 0.18, petalColor, 0.78);
  }
  for (let i = 0; i < 7; i += 1) {
    const a = (Math.PI * 2 * i) / 7 + 0.2;
    drawEllipse(buf, WIDTH, HEIGHT, cx + Math.cos(a) * size * 0.12, cy + Math.sin(a) * size * 0.08, size * 0.24, size * 0.1, a, mix(base, "#ffffff", 0.32), 0.72);
  }
  drawCircle(buf, WIDTH, HEIGHT, cx, cy, size * 0.14, "#e3d76f", 0.85);
}

function drawSunflower(buf, cx, cy, size, base, rand) {
  for (let i = 0; i < 18; i += 1) {
    const a = (Math.PI * 2 * i) / 18;
    drawEllipse(buf, WIDTH, HEIGHT, cx + Math.cos(a) * size * 0.52, cy + Math.sin(a) * size * 0.4, size * 0.34, size * 0.12, a, i % 2 ? "#ffd45e" : base, 0.9);
  }
  drawCircle(buf, WIDTH, HEIGHT, cx, cy, size * 0.34, "#6f4b2c", 0.95);
  for (let i = 0; i < 16; i += 1) {
    const a = rand() * Math.PI * 2;
    const r = rand() * size * 0.24;
    drawCircle(buf, WIDTH, HEIGHT, cx + Math.cos(a) * r, cy + Math.sin(a) * r, 0.95, "#3e2b1d", 0.42);
  }
}

function drawFlower(buf, flower, cx, cy, size, base, rand) {
  if (flower.id === "rose") drawRose(buf, cx, cy, size, base, rand);
  if (flower.id === "tulip") drawTulip(buf, cx, cy, size, base, rand);
  if (flower.id === "lisianthus") drawLisianthus(buf, cx, cy, size, base, rand);
  if (flower.id === "sunflower") drawSunflower(buf, cx, cy, size, base, rand);
}

function generate(file, scenario, flower, palette, layout, wrapper) {
  const rand = createRandom(seedFrom(`${scenario.id}:${flower.id}:${palette.id}:${layout.id}:${wrapper.id}`));
  const buf = Buffer.alloc(WIDTH * HEIGHT * 4, 255);
  drawBackground(buf, rand);
  drawWrapper(buf, palette, wrapper, scenario);

  const positions = layoutMap[layout.id];
  const baseX = 160;
  const baseY = 244;
  positions.forEach((point, index) => {
    const jitterX = (rand() - 0.5) * 8;
    const jitterY = (rand() - 0.5) * 7;
    const cx = (point[0] / 100) * WIDTH + jitterX;
    const cy = (point[1] / 100) * HEIGHT + 18 + jitterY;
    const size = point[2] * 0.56;
    const stemColor = index % 2 ? "#477c55" : "#5d9a63";
    drawLine(buf, WIDTH, HEIGHT, baseX + (rand() - 0.5) * 24, baseY, cx, cy + size * 0.5, 1.25, stemColor, 0.72);
    if (index % 2 === 0) drawLeaf(buf, (baseX + cx) / 2 + 8, (baseY + cy) / 2, 8 + rand() * 4, -0.55 + rand() * 0.3);
    if (index % 3 === 0) drawLeaf(buf, (baseX + cx) / 2 - 7, (baseY + cy) / 2 + 5, 7 + rand() * 3, 0.62 - rand() * 0.25, "#6aa06b");
  });

  for (let i = 0; i < 34; i += 1) {
    const x = 74 + rand() * 172;
    const y = 58 + rand() * 130;
    const r = 1.3 + rand() * 1.4;
    drawCircle(buf, WIDTH, HEIGHT, x, y, r, i % 4 === 0 ? scenario.accent : "#ffffff", 0.7);
  }

  positions.forEach((point, index) => {
    const jitterX = (rand() - 0.5) * 8;
    const jitterY = (rand() - 0.5) * 7;
    const cx = (point[0] / 100) * WIDTH + jitterX;
    const cy = (point[1] / 100) * HEIGHT + 18 + jitterY;
    const size = point[2] * 0.62;
    drawFlower(buf, flower, cx, cy, size, flowerColor(flower, palette, index), rand);
  });

  fs.writeFileSync(file, png(WIDTH, HEIGHT, buf));
}

fs.mkdirSync(outDir, { recursive: true });
let count = 0;
scenarios.forEach((scenario) => {
  flowers.forEach((flower) => {
    palettes.forEach((palette) => {
      layouts.forEach((layout) => {
        wrappers.forEach((wrapper) => {
          const file = path.join(outDir, `${scenario.id}_${flower.id}_${palette.id}_${layout.id}_${wrapper.id}.png`);
          generate(file, scenario, flower, palette, layout, wrapper);
          count += 1;
        });
      });
    });
  });
});
console.log(`Generated ${count} bouquet images in ${outDir}`);
