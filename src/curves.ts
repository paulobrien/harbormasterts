/**
 * Geometry of the original HD app's cBSpline3D::InBetween, reconstructed from
 * its arithmetic: a cubic Bezier whose control points are the two endpoints
 * offset by their stored direction vectors and scalar handle lengths.
 * Coordinates are game coordinates, not screen pixels.
 */
export interface CurvePoint { x: number; y: number }

/** Returns a point on a cubic Bezier, including its start and end. */
export function cubicBezier(
  start: CurvePoint,
  control1: CurvePoint,
  control2: CurvePoint,
  end: CurvePoint,
  t: number,
): CurvePoint {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * t * u * u;
  const c = 3 * t * t * u;
  const d = t * t * t;
  return {
    x: a * start.x + b * control1.x + c * control2.x + d * end.x,
    y: a * start.y + b * control1.y + c * control2.y + d * end.y,
  };
}

/**
 * Samples the native two-node curve at equally spaced steps, excluding the
 * existing start and including the target. The native spline constructor
 * scales both direction vectors by half the distance between its endpoints;
 * the target handle points back from the target.
 */
export function sampleNativeCurve(
  start: CurvePoint,
  startDirection: CurvePoint,
  end: CurvePoint,
  endDirection: CurvePoint,
  steps = 8,
  startLength = Math.hypot(end.x - start.x, end.y - start.y) / 2,
  endLength = Math.hypot(end.x - start.x, end.y - start.y) / 2,
): CurvePoint[] {
  if (!Number.isInteger(steps) || steps <= 0) throw new RangeError('Curve steps must be a positive integer');
  const c1 = { x: start.x + startDirection.x * startLength, y: start.y + startDirection.y * startLength };
  const c2 = { x: end.x - endDirection.x * endLength, y: end.y - endDirection.y * endLength };
  return Array.from({ length: steps }, (_, index) => cubicBezier(start, c1, c2, end, (index + 1) / steps));
}

/**
 * Normal touch-move rule from the HD cBoat::handleTouchMoved. A displacement
 * of at most 9 units adds no point, a displacement under 100 adds the finger
 * point, and a displacement of 100 or more fills a gap with eight curve points.
 * Callers still clip each resulting segment against the level's land geometry.
 * The original has an additional 32-unit threshold in a special boat state;
 * that behavior is intentionally not guessed here.
 */
export function nativeTouchSegment(
  start: CurvePoint,
  target: CurvePoint,
  startDirection: CurvePoint,
  endDirection: CurvePoint,
): CurvePoint[] {
  const dx = target.x - start.x;
  const dy = target.y - start.y;
  const distanceSquared = dx * dx + dy * dy;
  if (distanceSquared <= 81) return [];
  if (distanceSquared < 10000) return [{ x: target.x, y: target.y }];
  return sampleNativeCurve(start, startDirection, target, endDirection);
}
