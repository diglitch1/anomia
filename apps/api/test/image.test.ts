import exifReader from "exif-reader";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { ImageRejectedError, loadConfig, prepareImage } from "../src/image/index.js";
import { Limiter } from "../src/image/limiter.js";

const quiet = { log: false };

async function solidJpeg(width: number, height: number, color = { r: 200, g: 120, b: 40 }): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: color } }).jpeg().toBuffer();
}

async function noisyJpeg(width: number, height: number): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 3, background: { r: 128, g: 128, b: 128 }, noise: { type: "gaussian", mean: 128, sigma: 60 } },
  })
    .jpeg({ quality: 95 })
    .toBuffer();
}

type IfdEntry = { tag: number; type: 2 | 3 | 4 | 5; values: number[] | string };

/** Builds a little-endian TIFF/EXIF block with IFD0 and a GPS IFD, like a phone camera writes. */
function buildExif(ifd0: IfdEntry[], gps: IfdEntry[]): Buffer {
  const typeSize = { 2: 1, 3: 2, 4: 4, 5: 8 } as const;
  const ifdSize = (n: number) => 2 + n * 12 + 4;
  const valueBytes = (e: IfdEntry) => (typeof e.values === "string" ? e.values.length + 1 : e.values.length * typeSize[e.type]);
  const extra = (entries: IfdEntry[]) => entries.reduce((sum, e) => sum + (valueBytes(e) > 4 ? valueBytes(e) : 0), 0);

  const allIfd0 = [...ifd0, { tag: 0x8825, type: 4, values: [0] } as IfdEntry]; // GPSInfo pointer, patched below
  const ifd0Offset = 8;
  const gpsOffset = ifd0Offset + ifdSize(allIfd0.length) + extra(allIfd0);
  const buf = Buffer.alloc(gpsOffset + ifdSize(gps.length) + extra(gps));
  buf.write("II", 0, "ascii");
  buf.writeUInt16LE(42, 2);
  buf.writeUInt32LE(ifd0Offset, 4);
  allIfd0[allIfd0.length - 1]!.values = [gpsOffset];

  const writeIfd = (entries: IfdEntry[], offset: number) => {
    buf.writeUInt16LE(entries.length, offset);
    let dataOffset = offset + ifdSize(entries.length);
    entries.forEach((e, i) => {
      const at = offset + 2 + i * 12;
      const count = typeof e.values === "string" ? e.values.length + 1 : e.type === 5 ? e.values.length / 2 : e.values.length;
      buf.writeUInt16LE(e.tag, at);
      buf.writeUInt16LE(e.type, at + 2);
      buf.writeUInt32LE(count, at + 4);
      const inline = valueBytes(e) <= 4;
      let p = inline ? at + 8 : dataOffset;
      if (!inline) buf.writeUInt32LE(dataOffset, at + 8);
      if (typeof e.values === "string") buf.write(e.values, p, "ascii");
      else
        for (const v of e.values) {
          if (e.type === 3) buf.writeUInt16LE(v, p);
          else buf.writeUInt32LE(v, p);
          p += e.type === 3 ? 2 : 4;
        }
      if (!inline) dataOffset += valueBytes(e);
    });
    buf.writeUInt32LE(0, offset + 2 + entries.length * 12);
  };
  writeIfd(allIfd0, ifd0Offset);
  writeIfd(gps, gpsOffset);
  return buf;
}

/** Inserts an APP1 EXIF segment right after the JPEG SOI marker. */
function withExifSegment(jpeg: Buffer, tiff: Buffer): Buffer {
  const header = Buffer.from("Exif\0\0", "binary");
  const length = Buffer.alloc(2);
  length.writeUInt16BE(2 + header.length + tiff.length);
  return Buffer.concat([jpeg.subarray(0, 2), Buffer.from([0xff, 0xe1]), length, header, tiff, jpeg.subarray(2)]);
}

function phoneExif(orientation: number): Buffer {
  return buildExif(
    [
      { tag: 0x010f, type: 2, values: "SecretPhoneMaker" }, // Make
      { tag: 0x0112, type: 3, values: [orientation] }, // Orientation
    ],
    [
      { tag: 0x0001, type: 2, values: "N" }, // GPSLatitudeRef
      { tag: 0x0002, type: 5, values: [48, 1, 18, 1, 21, 1] }, // GPSLatitude: Linz
      { tag: 0x0003, type: 2, values: "E" }, // GPSLongitudeRef
      { tag: 0x0004, type: 5, values: [14, 1, 17, 1, 9, 1] }, // GPSLongitude
    ],
  );
}

async function expectRejected(promise: Promise<unknown>, code: ImageRejectedError["code"]) {
  const err = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(ImageRejectedError);
  expect((err as ImageRejectedError).code).toBe(code);
  // Messages go straight to users: short, fixed text, no bytes or encoded image data.
  expect((err as Error).message.length).toBeLessThan(120);
  expect((err as Error).message).not.toMatch(/[A-Za-z0-9+/]{40,}|Exif|0x/);
}

describe("prepareImage", () => {
  it("accepts a valid JPEG and returns a JPEG", async () => {
    const out = await prepareImage(await solidJpeg(640, 480), "image/jpeg", quiet);
    expect(out.mime).toBe("image/jpeg");
    expect(out.data.subarray(0, 3)).toEqual(Buffer.from([0xff, 0xd8, 0xff]));
    const meta = await sharp(out.data).metadata();
    expect(meta.format).toBe("jpeg");
    expect([meta.width, meta.height]).toEqual([640, 480]);
  });

  it("accepts mime variants with parameters and different case", async () => {
    const jpeg = await solidJpeg(32, 32);
    await expect(prepareImage(jpeg, "Image/JPEG; charset=binary", quiet)).resolves.toMatchObject({ mime: "image/jpeg" });
    await expect(prepareImage(jpeg, "image/jpg", quiet)).resolves.toMatchObject({ mime: "image/jpeg" });
  });

  it("rejects a PNG declared as JPEG", async () => {
    const png = await sharp({ create: { width: 64, height: 64, channels: 3, background: "red" } }).png().toBuffer();
    await expectRejected(prepareImage(png, "image/jpeg", quiet), "unsupported_type");
  });

  it("rejects other formats declared as JPEG", async () => {
    const webp = await sharp({ create: { width: 64, height: 64, channels: 3, background: "red" } }).webp().toBuffer();
    await expectRejected(prepareImage(webp, "image/jpeg", quiet), "unsupported_type");
    await expectRejected(prepareImage(Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>"), "image/jpeg", quiet), "unsupported_type");
  });

  it("rejects JPEG bytes declared as another type", async () => {
    await expectRejected(prepareImage(await solidJpeg(32, 32), "image/png", quiet), "unsupported_type");
    await expectRejected(prepareImage(await solidJpeg(32, 32), "", quiet), "unsupported_type");
  });

  it("rejects an empty buffer", async () => {
    await expectRejected(prepareImage(Buffer.alloc(0), "image/jpeg", quiet), "empty");
  });

  it("rejects corrupt JPEG data", async () => {
    const garbage = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(2048, 0x5a)]);
    await expectRejected(prepareImage(garbage, "image/jpeg", quiet), "unreadable");
  });

  it("rejects a truncated JPEG", async () => {
    const full = await noisyJpeg(400, 300);
    await expectRejected(prepareImage(full.subarray(0, Math.floor(full.length / 2)), "image/jpeg", quiet), "unreadable");
  });

  it("rejects input over the byte limit before decoding", async () => {
    const jpeg = await noisyJpeg(400, 300);
    await expectRejected(prepareImage(jpeg, "image/jpeg", { ...quiet, maxInputBytes: jpeg.length - 1 }), "too_large");
  });

  it("rejects input over the pixel limit", async () => {
    await expectRejected(prepareImage(await solidJpeg(1000, 1000), "image/jpeg", { ...quiet, maxInputPixels: 999_999 }), "too_large");
  });

  it("rejects a 60 MP image with the default limits", async () => {
    // Small in bytes (solid colour) but huge in pixels: the decompression-bomb case.
    const bomb = await solidJpeg(10_000, 6_000);
    expect(bomb.length).toBeLessThan(loadConfig({}).maxInputBytes);
    await expectRejected(prepareImage(bomb, "image/jpeg", quiet), "too_large");
  });

  it("removes EXIF including GPS and all other metadata", async () => {
    const input = withExifSegment(
      await sharp(await solidJpeg(300, 200)).withXmp('<x:xmpmeta xmlns:x="adobe:ns:meta/">SecretXmp</x:xmpmeta>').jpeg().toBuffer(),
      phoneExif(1),
    );
    const inMeta = await sharp(input).metadata();
    const inExif = exifReader(inMeta.exif!);
    expect(inExif.GPSInfo?.GPSLatitude).toEqual([48, 18, 21]);
    expect(inExif.GPSInfo?.GPSLongitudeRef).toBe("E");
    expect(inMeta.xmp).toBeDefined();

    const out = await prepareImage(input, "image/jpeg", quiet);
    const outMeta = await sharp(out.data).metadata();
    expect(outMeta.exif).toBeUndefined();
    expect(outMeta.xmp).toBeUndefined();
    expect(outMeta.iptc).toBeUndefined();
    expect(outMeta.icc).toBeUndefined();
    expect(outMeta.orientation).toBeUndefined();
    // Belt and braces: no APP1 segment and no trace of the original strings in the bytes.
    expect(out.data.includes(Buffer.from([0xff, 0xe1]))).toBe(false);
    expect(out.data.includes(Buffer.from("Exif"))).toBe(false);
    expect(out.data.includes(Buffer.from("SecretPhoneMaker"))).toBe(false);
    expect(out.data.includes(Buffer.from("SecretXmp"))).toBe(false);
  });

  it("applies EXIF orientation before stripping it", async () => {
    // Stored landscape: left half red, right half blue. Orientation 6 means "rotate 90° clockwise to display".
    const half = (color: string) => sharp({ create: { width: 100, height: 100, channels: 3, background: color } }).png().toBuffer();
    const stored = await sharp({ create: { width: 200, height: 100, channels: 3, background: "black" } })
      .composite([
        { input: await half("red"), left: 0, top: 0 },
        { input: await half("blue"), left: 100, top: 0 },
      ])
      .jpeg()
      .toBuffer();
    const input = withExifSegment(stored, phoneExif(6));
    expect((await sharp(input).metadata()).orientation).toBe(6);

    const out = await prepareImage(input, "image/jpeg", quiet);
    const { data, info } = await sharp(out.data).raw().toBuffer({ resolveWithObject: true });
    expect([info.width, info.height]).toEqual([100, 200]);
    const pixel = (x: number, y: number) => {
      const i = (y * info.width + x) * info.channels;
      return { r: data[i]!, b: data[i + 2]! };
    };
    expect(pixel(50, 20).r).toBeGreaterThan(200); // top is red
    expect(pixel(50, 20).b).toBeLessThan(60);
    expect(pixel(50, 180).b).toBeGreaterThan(200); // bottom is blue
    expect(pixel(50, 180).r).toBeLessThan(60);
  });

  it("keeps the output within the side and byte limits", async () => {
    const defaults = loadConfig({});
    for (const [w, h] of [
      [4032, 3024],
      [3024, 4032],
      [1500, 1500],
    ] as const) {
      const out = await prepareImage(await noisyJpeg(w, h), "image/jpeg", quiet);
      const meta = await sharp(out.data).metadata();
      expect(Math.max(meta.width!, meta.height!)).toBe(defaults.maxSide);
      expect(out.data.length).toBeLessThanOrEqual(defaults.maxOutputBytes);
    }
  }, 30_000); // generating 12 MP noise inputs is the slow part

  it("keeps the aspect ratio when resizing", async () => {
    const out = await prepareImage(await solidJpeg(4000, 3000), "image/jpeg", { ...quiet, maxSide: 800 });
    const meta = await sharp(out.data).metadata();
    expect([meta.width, meta.height]).toEqual([800, 600]);
  });

  it("lowers quality to fit a tight byte limit, and rejects when it cannot", async () => {
    const noisy = await noisyJpeg(1024, 1024);
    const roomy = await prepareImage(noisy, "image/jpeg", { ...quiet, maxSide: 512 });
    const tight = await prepareImage(noisy, "image/jpeg", { ...quiet, maxSide: 512, maxOutputBytes: Math.floor(roomy.data.length * 0.8) });
    expect(tight.data.length).toBeLessThanOrEqual(Math.floor(roomy.data.length * 0.8));
    await expectRejected(prepareImage(noisy, "image/jpeg", { ...quiet, maxSide: 512, maxOutputBytes: 1024 }), "too_large");
  });

  it("does not upscale small images", async () => {
    const out = await prepareImage(await solidJpeg(300, 200), "image/jpeg", quiet);
    const meta = await sharp(out.data).metadata();
    expect([meta.width, meta.height]).toEqual([300, 200]);
  });

  it("logs only sizes and timing", async () => {
    const lines: string[] = [];
    const original = console.info;
    console.info = (...args: unknown[]) => void lines.push(args.join(" "));
    try {
      await prepareImage(withExifSegment(await solidJpeg(300, 200), phoneExif(1)), "image/jpeg", { log: true });
    } finally {
      console.info = original;
    }
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^\[image\] in=\d+B 300x200 out=\d+B 300x200 q=\d+ wait=\d+ms took=\d+ms$/);
  });
});

describe("loadConfig", () => {
  it("reads overrides from the environment", () => {
    const cfg = loadConfig({ IMAGE_MAX_SIDE: "1024", IMAGE_JPEG_QUALITY: "70", IMAGE_LOG: "0" });
    expect(cfg).toMatchObject({ maxSide: 1024, quality: 70, log: false });
  });

  it("fails fast on invalid values", () => {
    expect(() => loadConfig({ IMAGE_MAX_SIDE: "big" })).toThrow(/IMAGE_MAX_SIDE/);
    expect(() => loadConfig({ IMAGE_JPEG_QUALITY: "101" })).toThrow(/IMAGE_JPEG_QUALITY/);
  });
});

describe("Limiter", () => {
  it("never runs more than the limit at once", async () => {
    const limiter = new Limiter(2);
    let running = 0;
    let peak = 0;
    const task = () =>
      limiter.run(async () => {
        peak = Math.max(peak, ++running);
        await new Promise((r) => setTimeout(r, 5));
        running--;
      });
    await Promise.all(Array.from({ length: 8 }, task));
    expect(peak).toBe(2);
  });

  it("releases the slot when a task throws", async () => {
    const limiter = new Limiter(1);
    await expect(limiter.run(() => Promise.reject(new Error("boom")))).rejects.toThrow("boom");
    await expect(limiter.run(async () => "ok")).resolves.toBe("ok");
  });
});
