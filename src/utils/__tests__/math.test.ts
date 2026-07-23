import { inSphere } from '../math';

describe('math utility - inSphere', () => {
  it('should return the same buffer instance with expected length', () => {
    const buffer = new Float32Array(30);
    const result = inSphere(buffer, { radius: 10 });

    expect(result).toBe(buffer);
    expect(result.length).toBe(30);
  });

  it('should use default radius of 1 when none is specified', () => {
    const buffer = new Float32Array(300); // 100 points
    inSphere(buffer);

    for (let i = 0; i < 100; i++) {
      const x = buffer[i * 3];
      const y = buffer[i * 3 + 1];
      const z = buffer[i * 3 + 2];
      const dist = Math.sqrt(x * x + y * y + z * z);

      expect(dist).toBeLessThanOrEqual(1.00001);
    }
  });

  it('should generate points strictly within the specified sphere radius', () => {
    const radius = 5;
    const buffer = new Float32Array(300); // 100 points
    inSphere(buffer, { radius });

    for (let i = 0; i < 100; i++) {
      const x = buffer[i * 3];
      const y = buffer[i * 3 + 1];
      const z = buffer[i * 3 + 2];
      const dist = Math.sqrt(x * x + y * y + z * z);

      expect(dist).toBeLessThanOrEqual(radius + 0.00001);
    }
  });

  it('should maintain uniform volume distribution (expected average distance is 0.75 * radius)', () => {
    const radius = 10;
    const pointCount = 5000;
    const buffer = new Float32Array(pointCount * 3);
    inSphere(buffer, { radius });

    let totalDist = 0;
    let xSum = 0;
    let ySum = 0;
    let zSum = 0;

    for (let i = 0; i < pointCount; i++) {
      const x = buffer[i * 3];
      const y = buffer[i * 3 + 1];
      const z = buffer[i * 3 + 2];
      const dist = Math.sqrt(x * x + y * y + z * z);

      totalDist += dist;
      xSum += x;
      ySum += y;
      zSum += z;
    }

    const averageDistance = totalDist / pointCount;
    const expectedAverageDistance = 0.75 * radius;

    // Check that the average distance matches the theoretical expectation within a small tolerance
    expect(averageDistance).toBeCloseTo(expectedAverageDistance, 1);

    // Check that the points are centered around the origin (mean coordinate is close to 0)
    expect(xSum / pointCount).toBeCloseTo(0, 0);
    expect(ySum / pointCount).toBeCloseTo(0, 0);
    expect(zSum / pointCount).toBeCloseTo(0, 0);
  });
});
