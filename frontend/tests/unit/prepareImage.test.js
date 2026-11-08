import { describe, it, expect, vi } from 'vitest';
import {
  prepareImage,
  COMPRESS_THRESHOLD_BYTES,
  MAX_UPLOAD_BYTES,
  COMPRESSION_STEPS,
  TOO_LARGE_MESSAGE,
  UNREADABLE_MESSAGE,
} from '../../app/lib/prepareImage';

const MB = 1024 * 1024;

const fileOfSize = (size, name = 'photo.jpg', type = 'image/jpeg') =>
  new File([new Uint8Array(size)], name, { type });
const blobOfSize = (size) => new Blob([new Uint8Array(size)], { type: 'image/jpeg' });

function fakeDecoded() {
  return { source: {}, width: 4000, height: 3000, close: vi.fn() };
}

describe('prepareImage', () => {
  it('stays below the 4.5 MB Vercel request limit', () => {
    expect(MAX_UPLOAD_BYTES).toBeLessThan(4.5 * MB);
    expect(COMPRESS_THRESHOLD_BYTES).toBeLessThan(MAX_UPLOAD_BYTES);
  });

  it('returns small photos untouched without decoding them', async () => {
    const file = fileOfSize(COMPRESS_THRESHOLD_BYTES, 'small.png', 'image/png');
    const decode = vi.fn();
    const encode = vi.fn();

    const result = await prepareImage(file, { decode, encode });

    expect(result).toBe(file);
    expect(decode).not.toHaveBeenCalled();
    expect(encode).not.toHaveBeenCalled();
  });

  it('shrinks a large photo into a JPEG that fits the upload limit', async () => {
    const file = fileOfSize(8 * MB, 'IMG_0001.HEIC', 'image/heic');
    const decoded = fakeDecoded();
    const decode = vi.fn().mockResolvedValue(decoded);
    const encode = vi.fn().mockResolvedValue(blobOfSize(2 * MB));

    const result = await prepareImage(file, { decode, encode });

    expect(result).not.toBe(file);
    expect(result.name).toBe('IMG_0001.jpg');
    expect(result.type).toBe('image/jpeg');
    expect(result.size).toBe(2 * MB);
    expect(decode).toHaveBeenCalledWith(file);
    expect(encode).toHaveBeenCalledTimes(1);
    expect(encode).toHaveBeenCalledWith(
      decoded,
      COMPRESSION_STEPS[0].maxDimension,
      COMPRESSION_STEPS[0].quality
    );
    expect(decoded.close).toHaveBeenCalledTimes(1);
  });

  it('keeps trying smaller settings until the result fits', async () => {
    const decoded = fakeDecoded();
    const decode = vi.fn().mockResolvedValue(decoded);
    const encode = vi
      .fn()
      .mockResolvedValueOnce(blobOfSize(5 * MB))
      .mockResolvedValueOnce(blobOfSize(4 * MB))
      .mockResolvedValueOnce(blobOfSize(3 * MB));

    const result = await prepareImage(fileOfSize(9 * MB), { decode, encode });

    expect(result.size).toBe(3 * MB);
    expect(encode).toHaveBeenCalledTimes(3);
    COMPRESSION_STEPS.slice(0, 3).forEach((step, index) => {
      expect(encode).toHaveBeenNthCalledWith(index + 1, decoded, step.maxDimension, step.quality);
    });
    expect(decoded.close).toHaveBeenCalledTimes(1);
  });

  it('gives up with a clear message when no setting makes it small enough', async () => {
    const decoded = fakeDecoded();
    const decode = vi.fn().mockResolvedValue(decoded);
    const encode = vi.fn().mockResolvedValue(blobOfSize(6 * MB));

    await expect(prepareImage(fileOfSize(9 * MB), { decode, encode })).rejects.toThrow(
      TOO_LARGE_MESSAGE
    );

    expect(encode).toHaveBeenCalledTimes(COMPRESSION_STEPS.length);
    expect(decoded.close).toHaveBeenCalledTimes(1);
  });

  it('sends an unreadable format as-is when it already fits the limit', async () => {
    const file = fileOfSize(2 * MB, 'photo.heic', 'image/heic');
    const decode = vi.fn().mockRejectedValue(new Error('cannot decode'));
    const encode = vi.fn();

    const result = await prepareImage(file, { decode, encode });

    expect(result).toBe(file);
    expect(encode).not.toHaveBeenCalled();
  });

  it('rejects an unreadable format that is too large to send as-is', async () => {
    const file = fileOfSize(8 * MB, 'photo.heic', 'image/heic');
    const decode = vi.fn().mockRejectedValue(new Error('cannot decode'));

    await expect(prepareImage(file, { decode, encode: vi.fn() })).rejects.toThrow(
      UNREADABLE_MESSAGE
    );
  });

  it.each([
    ['holiday.photo.png', 'holiday.photo.jpg'],
    ['plate', 'plate.jpg'],
    ['', 'photo.jpg'],
  ])('names the compressed file for "%s" as "%s"', async (originalName, expected) => {
    const decode = vi.fn().mockResolvedValue(fakeDecoded());
    const encode = vi.fn().mockResolvedValue(blobOfSize(1 * MB));

    const result = await prepareImage(fileOfSize(5 * MB, originalName), { decode, encode });

    expect(result.name).toBe(expected);
  });
});
