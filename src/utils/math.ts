/**
 * Utility functions for mathematical operations, such as spherical distributions.
 */

/**
 * Fills a Float32Array with points uniformly distributed inside a sphere of a given radius.
 * Each point is represented by 3 consecutive elements (x, y, z) in the array.
 *
 * This implementation uses inverse transform sampling to achieve a uniform mathematical
 * volume distribution across the entire sphere, preventing point clustering near the center.
 *
 * @param buffer The Float32Array to fill.
 * @param options Configuration options including radius.
 * @returns The filled Float32Array.
 */
export function inSphere(
  buffer: Float32Array,
  options: { radius?: number } = {}
): Float32Array {
  const radius = options.radius ?? 1;
  const count = buffer.length / 3;

  for (let i = 0; i < count; i++) {
    // 1. Generate distance r from center using inverse transform sampling of volume density:
    //    r = R * u^(1/3), where u is uniform in [0, 1]
    const u = Math.random();
    const r = radius * Math.cbrt(u);

    // 2. Generate a point on a unit sphere uniformly:
    //    theta is uniform in [0, 2*pi]
    //    cos(phi) is uniform in [-1, 1]
    const theta = Math.random() * 2 * Math.PI;
    const cosPhi = Math.random() * 2 - 1;
    const sinPhi = Math.sqrt(1 - cosPhi * cosPhi);

    const x = r * sinPhi * Math.cos(theta);
    const y = r * sinPhi * Math.sin(theta);
    const z = r * cosPhi;

    buffer[i * 3] = x;
    buffer[i * 3 + 1] = y;
    buffer[i * 3 + 2] = z;
  }

  return buffer;
}
