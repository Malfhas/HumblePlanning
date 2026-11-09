import { describe, expect, it } from "bun:test";
import sharp from "sharp";
import { IMAGE_MAX_PX, imageForModel } from "./attachments";

const png = (width: number, height: number) =>
  sharp({ create: { width, height, channels: 4, background: { r: 30, g: 120, b: 200, alpha: 0.5 } } }).png().toBuffer();

describe("images sent to the model", () => {
  it("a large image is reduced to IMAGE_MAX_PX on its long side, in JPEG", async () => {
    const image = await imageForModel(await png(6000, 3000), "image/png");
    const meta = await sharp(image.buffer).metadata();
    expect(image.type).toBe("image/jpeg");
    expect(meta.format).toBe("jpeg");
    expect(Math.max(meta.width ?? 0, meta.height ?? 0)).toBe(IMAGE_MAX_PX);
  });

  it("a small image in a format the models read goes as is", async () => {
    const small = await png(400, 300);
    const image = await imageForModel(small, "image/png");
    expect(image.type).toBe("image/png");
    expect(image.buffer.equals(small)).toBe(true);
  });

  it("a format the models do not read is converted, without enlarging it", async () => {
    const avif = await sharp({ create: { width: 300, height: 200, channels: 3, background: "#ff0000" } }).avif().toBuffer();
    const image = await imageForModel(avif, "image/avif");
    const meta = await sharp(image.buffer).metadata();
    expect(image.type).toBe("image/jpeg");
    expect([meta.width, meta.height]).toEqual([300, 200]);
  });

  it("an unreadable image goes as is", async () => {
    const broken = Buffer.from("not an image");
    expect(await imageForModel(broken, "image/png")).toEqual({ buffer: broken, type: "image/png" });
  });
});
