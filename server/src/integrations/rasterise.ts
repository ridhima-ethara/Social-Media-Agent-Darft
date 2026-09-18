/**
 * RASTERISE — turn a brand SVG into a PNG a social platform will accept.
 *
 * WHY THIS EXISTS. Every creative this product renders locally is an SVG, because
 * the brand layer is drawn as vectors and FLUX.2 Klein — which would produce a
 * raster — has no working transport on this machine. No social platform accepts
 * SVG for a feed image: LinkedIn, Instagram, X and Facebook all require PNG or
 * JPEG. So a post carrying a brand creative published as text only, and the image
 * was silently the one part of the work that never shipped.
 *
 * This converts at the publishing boundary rather than at render time. The SVG
 * stays the stored artefact — it is resolution-independent, diffable, and what the
 * UI previews — and the PNG is derived on demand for the one consumer that needs
 * it. Storing both would mean two things to keep in step.
 *
 * `sharp` reads SVG through libvips, which links librsvg. That is a real renderer
 * rather than a regex over the markup, so gradients, masks and embedded fonts come
 * out as drawn.
 */

import sharp from 'sharp'

/** What a platform will accept, and what libvips can produce from an SVG. */
export type RasterFormat = 'png' | 'jpeg'

export interface RasterResult {
  bytes: Buffer
  contentType: string
  width: number
  height: number
}

/**
 * Pulls the base64 payload out of a data URI.
 *
 * Returns null rather than throwing: an asset row with an empty `data_uri` is a
 * known state in this product, and the publish path must degrade to text rather
 * than fail.
 */
export function decodeDataUri(dataUri: string): { bytes: Buffer; mime: string } | null {
  const match = /^data:([^;,]+)(;base64)?,(.*)$/s.exec(dataUri.trim())
  if (match === null) return null
  const mime = match[1] ?? ''
  const isBase64 = match[2] !== undefined
  const payload = match[3] ?? ''
  if (payload === '') return null
  return {
    bytes: Buffer.from(payload, isBase64 ? 'base64' : 'utf8'),
    mime,
  }
}

/** True when the payload is already a format a platform accepts. */
export function isPublishableRaster(mime: string): boolean {
  return /^image\/(png|jpe?g)$/i.test(mime)
}

/**
 * Rasterises a creative to PNG.
 *
 * `density` is the reason this looks different from a normal resize: libvips
 * renders an SVG at a DPI, not at a pixel size, so asking for a 1200px-wide
 * output means rendering at a density that produces it. Rasterising at the SVG's
 * nominal size and scaling up afterwards would blur type that was drawn as
 * vectors — the whole point of keeping the brand layer vector.
 *
 * A payload that is already PNG or JPEG is returned untouched. Re-encoding it
 * would cost quality for nothing.
 */
export async function rasterise(
  dataUri: string,
  opts: { width?: number; format?: RasterFormat } = {},
): Promise<RasterResult | null> {
  const decoded = decodeDataUri(dataUri)
  if (decoded === null) return null

  const targetWidth = opts.width ?? 1200
  const format = opts.format ?? 'png'

  if (isPublishableRaster(decoded.mime)) {
    const meta = await sharp(decoded.bytes).metadata()
    return {
      bytes: decoded.bytes,
      contentType: decoded.mime.toLowerCase(),
      width: meta.width ?? 0,
      height: meta.height ?? 0,
    }
  }

  if (!/svg/i.test(decoded.mime)) {
    // An unexpected format is refused rather than guessed at. Feeding an unknown
    // payload to libvips would either throw deep in a native call or produce
    // something no one inspected.
    return null
  }

  // Read the intrinsic width so the density needed for `targetWidth` can be
  // computed. Without this, `density` is a guess and the output size is whatever
  // the SVG's own units happened to be.
  const probe = await sharp(decoded.bytes).metadata()
  const intrinsicWidth = probe.width ?? targetWidth
  const density = Math.min(
    2400,
    Math.max(72, Math.round((72 * targetWidth) / Math.max(1, intrinsicWidth))),
  )

  const pipeline = sharp(decoded.bytes, { density })
  const encoded =
    format === 'jpeg'
      ? // Flattened onto white: JPEG has no alpha, and an unflattened transparent
        // region encodes as black, which would ruin a brand card.
        pipeline.flatten({ background: '#ffffff' }).jpeg({ quality: 90 })
      : pipeline.png({ compressionLevel: 9 })

  const bytes = await encoded.toBuffer()
  const meta = await sharp(bytes).metadata()

  return {
    bytes,
    contentType: format === 'jpeg' ? 'image/jpeg' : 'image/png',
    width: meta.width ?? 0,
    height: meta.height ?? 0,
  }
}
