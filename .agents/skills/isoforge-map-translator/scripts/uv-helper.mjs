#!/usr/bin/env node
/**
 * Helper determinístico de geometria UV -> Mundo (X, Z) para agentes de IA locais.
 * Evita erros trigonométricos de modelos menores ao traçar muros em ângulo ou medir imagens.
 *
 * Exemplos:
 *   node uv-helper.mjs --image public/maps/ruinas-rio.jpg --ortho 32
 *   node uv-helper.mjs --width 18 --depth 32 --point 0.55,0.525
 *   node uv-helper.mjs --width 18 --depth 32 --wall 0.06,0.075,0.25,0.04,0.58
 */

import fs from 'node:fs';

export function readImageDimensions(filePath) {
  const buf = fs.readFileSync(filePath);
  // PNG: signature + IHDR width/height at offsets 16..24
  if (buf.length >= 24 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    return {
      width: buf.readUInt32BE(16),
      height: buf.readUInt32BE(20),
    };
  }
  // JPEG: scan SOF0/SOF1/SOF2 markers (0xFFC0..0xFFC2)
  if (buf.length >= 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let offset = 2;
    while (offset + 8 < buf.length) {
      if (buf[offset] !== 0xff) break;
      const marker = buf[offset + 1];
      const segLen = buf.readUInt16BE(offset + 2);
      if (marker >= 0xc0 && marker <= 0xc3) {
        return {
          height: buf.readUInt16BE(offset + 5),
          width: buf.readUInt16BE(offset + 7),
        };
      }
      offset += 2 + segLen;
    }
  }
  throw new Error(`Formato de imagem não suportado (use PNG ou JPEG): ${filePath}`);
}

export function uvToWorldXZ(u, v, width, depth) {
  return [
    Number(((u - 0.5) * width).toFixed(2)),
    Number(((v - 0.5) * depth).toFixed(2)),
  ];
}

export function wallSegmentFootprint(u0, v0, u1, v1, width, depth, thickness = 0.58) {
  const [x0, z0] = uvToWorldXZ(u0, v0, width, depth);
  const [x1, z1] = uvToWorldXZ(u1, v1, width, depth);
  const dx = x1 - x0;
  const dz = z1 - z0;
  const len = Math.hypot(dx, dz) || 1;
  const px = (-dz / len) * (thickness * 0.5);
  const pz = (dx / len) * (thickness * 0.5);

  return [
    [Number((x0 + px).toFixed(2)), Number((z0 + pz).toFixed(2))],
    [Number((x1 + px).toFixed(2)), Number((z1 + pz).toFixed(2))],
    [Number((x1 - px).toFixed(2)), Number((z1 - pz).toFixed(2))],
    [Number((x0 - px).toFixed(2)), Number((z0 - pz).toFixed(2))],
  ];
}

function runCli() {
  const args = process.argv.slice(2);
  const getArg = (flag) => {
    const idx = args.indexOf(flag);
    return idx >= 0 ? args[idx + 1] : null;
  };

  const imgPath = getArg('--image');
  if (imgPath) {
    const dims = readImageDimensions(imgPath);
    const aspectRatio = Number((dims.width / dims.height).toFixed(6));
    const orthoScale = Number(getArg('--ortho') ?? (aspectRatio < 1 ? 32 : 22));
    const depth = orthoScale;
    const width = Number((orthoScale * aspectRatio).toFixed(3));
    console.log(
      JSON.stringify({
        pixelWidth: dims.width,
        pixelHeight: dims.height,
        aspectRatio,
        orthoScale,
        terrain: { width, depth },
      }, null, 2)
    );
    return;
  }

  const width = Number(getArg('--width') ?? 20);
  const depth = Number(getArg('--depth') ?? 20);
  const ptStr = getArg('--point');
  if (ptStr) {
    const [u, v] = ptStr.split(',').map(Number);
    console.log(JSON.stringify({ xz: uvToWorldXZ(u, v, width, depth) }));
    return;
  }

  const wallStr = getArg('--wall');
  if (wallStr) {
    const [u0, v0, u1, v1, thick] = wallStr.split(',').map(Number);
    console.log(
      JSON.stringify({
        footprint: wallSegmentFootprint(u0, v0, u1, v1, width, depth, thick || 0.58),
      })
    );
    return;
  }

  console.error('Use --image <path> [--ortho N] | --width W --depth D --point u,v | --wall u0,v0,u1,v1,espessura');
  process.exit(1);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runCli();
}

