/**
 * Shrinks large photos in the browser before they are uploaded.
 *
 * Vercel rejects request bodies over 4.5 MB (HTTP 413), and phone or camera
 * photos are often bigger than that. Photos at or below COMPRESS_THRESHOLD_BYTES
 * are sent untouched; larger ones are resized and re-encoded as JPEG, trying
 * progressively smaller settings until they fit under MAX_UPLOAD_BYTES.
 */

export const COMPRESS_THRESHOLD_BYTES = 1.5 * 1024 * 1024;
// Vercel's limit is 4.5 MB for the whole request; keep headroom for form overhead.
export const MAX_UPLOAD_BYTES = 3.5 * 1024 * 1024;

export const COMPRESSION_STEPS = [
  { maxDimension: 1600, quality: 0.85 },
  { maxDimension: 1600, quality: 0.75 },
  { maxDimension: 1280, quality: 0.7 },
  { maxDimension: 1024, quality: 0.65 },
  { maxDimension: 800, quality: 0.6 },
];

export const TOO_LARGE_MESSAGE =
  'This photo is too large to upload. Please try a smaller photo.';
export const UNREADABLE_MESSAGE =
  'This image could not be processed. Please try a JPEG or PNG photo.';

async function decodeImage(file) {
  if (typeof createImageBitmap === 'function') {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    return {
      source: bitmap,
      width: bitmap.width,
      height: bitmap.height,
      close: () => bitmap.close && bitmap.close(),
    };
  }

  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return {
      source: img,
      width: img.naturalWidth,
      height: img.naturalHeight,
      close: () => {},
    };
  } finally {
    URL.revokeObjectURL(url);
  }
}

function encodeJpeg(decoded, maxDimension, quality) {
  const scale = Math.min(1, maxDimension / Math.max(decoded.width, decoded.height));
  const width = Math.max(1, Math.round(decoded.width * scale));
  const height = Math.max(1, Math.round(decoded.height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  // JPEG has no transparency, so paint a white background first.
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, width, height);
  context.drawImage(decoded.source, 0, 0, width, height);

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error(UNREADABLE_MESSAGE))),
      'image/jpeg',
      quality
    );
  });
}

function jpegName(originalName) {
  const base = (originalName || 'photo').replace(/\.[^./\\]+$/, '');
  return `${base || 'photo'}.jpg`;
}

/**
 * @param {File} file the image the user picked
 * @param {{decode?: Function, encode?: Function}} [deps] overridable for tests
 * @returns {Promise<File>} the original file, or a smaller JPEG copy of it
 */
export async function prepareImage(file, deps = {}) {
  const decode = deps.decode || decodeImage;
  const encode = deps.encode || encodeJpeg;

  if (file.size <= COMPRESS_THRESHOLD_BYTES) {
    return file;
  }

  let decoded;
  try {
    decoded = await decode(file);
  } catch {
    // The browser could not read this format. Send it as-is only if it fits.
    if (file.size <= MAX_UPLOAD_BYTES) return file;
    throw new Error(UNREADABLE_MESSAGE);
  }

  try {
    for (const step of COMPRESSION_STEPS) {
      const blob = await encode(decoded, step.maxDimension, step.quality);
      if (blob.size <= MAX_UPLOAD_BYTES) {
        return new File([blob], jpegName(file.name), { type: 'image/jpeg' });
      }
    }
  } finally {
    decoded.close();
  }

  throw new Error(TOO_LARGE_MESSAGE);
}
