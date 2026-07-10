export interface RadarPoint {
  x: number;
  y: number;
}

export interface RadarGeometry {
  center: number;
}

export const DEFAULT_RADAR_GEOMETRY: RadarGeometry = {
  center: 110,
};

export function angleForIndex(index: number, total: number): number {
  return -Math.PI / 2 + (Math.PI * 2 * index) / Math.max(total, 1);
}

export function pointAt(
  angle: number,
  radius: number,
  geometry: RadarGeometry = DEFAULT_RADAR_GEOMETRY,
): RadarPoint {
  return {
    x: geometry.center + Math.cos(angle) * radius,
    y: geometry.center + Math.sin(angle) * radius,
  };
}

export function scaleFromCenter(
  point: RadarPoint,
  level: number,
  geometry: RadarGeometry = DEFAULT_RADAR_GEOMETRY,
): RadarPoint {
  return {
    x: geometry.center + (point.x - geometry.center) * level,
    y: geometry.center + (point.y - geometry.center) * level,
  };
}

export function labelAnchor(
  x: number,
  geometry: RadarGeometry = DEFAULT_RADAR_GEOMETRY,
  deadZone = 12,
): "start" | "middle" | "end" {
  if (x < geometry.center - deadZone) return "end";
  if (x > geometry.center + deadZone) return "start";
  return "middle";
}
