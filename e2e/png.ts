import zlib from 'node:zlib';

// Just enough PNG decoding to look at Playwright's screenshots: 8-bit RGB or RGBA, not interlaced.

export interface Pixels {
  width: number;
  height: number;
  /** RGBA, 4 bytes per pixel. */
  data: Uint8Array;
}

export function decodePng(buf: Buffer): Pixels {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG');
  let width = 0;
  let height = 0;
  let channels = 0;
  const idat: Buffer[] = [];
  for (let at = 8; at < buf.length; ) {
    const len = buf.readUInt32BE(at);
    const type = buf.toString('latin1', at + 4, at + 8);
    const body = buf.subarray(at + 8, at + 8 + len);
    if (type === 'IHDR') {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      const [depth, colour, , , interlace] = body.subarray(8, 13);
      channels = colour === 6 ? 4 : colour === 2 ? 3 : 0;
      if (depth !== 8 || !channels || interlace) throw new Error(`unsupported PNG (depth ${depth}, colour type ${colour}, interlace ${interlace})`);
    } else if (type === 'IDAT') idat.push(body);
    else if (type === 'IEND') break;
    at += 12 + len;
  }

  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const rows = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const row = rows.subarray(y * stride, (y + 1) * stride);
    const up = y > 0 ? rows.subarray((y - 1) * stride, y * stride) : new Uint8Array(stride);
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? row[i - channels] : 0;
      const b = up[i];
      const c = i >= channels ? up[i - channels] : 0;
      let v = src[i];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      row[i] = v & 0xff;
    }
  }

  const data = new Uint8Array(width * height * 4);
  for (let p = 0; p < width * height; p++) {
    data.set(rows.subarray(p * channels, p * channels + 3), p * 4);
    data[p * 4 + 3] = channels === 4 ? rows[p * channels + 3] : 255;
  }
  return { width, height, data };
}

/** How many different colours the image has, and what share of its pixels the most common one covers. */
export function colourStats({ width, height, data }: Pixels): { colours: number; topShare: number } {
  const counts = new Map<number, number>();
  for (let p = 0; p < width * height; p++) {
    const key = (data[p * 4] << 16) | (data[p * 4 + 1] << 8) | data[p * 4 + 2];
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  let top = 0;
  for (const n of counts.values()) top = Math.max(top, n);
  return { colours: counts.size, topShare: top / (width * height) };
}
