export type MapPoint = { lat: number; lng: number };
export type GeoJsonPolygon = { type: 'Polygon'; coordinates: number[][][] };
export type ParsedPolygon = { rings: [number, number][][]; vertexCount: number };

const MAX_EDITOR_VERTICES = 500;
const EARTH_RADIUS_METERS = 6_378_137;
const DEGREES_TO_RADIANS = Math.PI / 180;
const INTERSECTION_EPSILON = 1e-12;

function isFiniteCoordinate(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function sameCoordinate(first: number[], second: number[]) {
  return first[0] === second[0] && first[1] === second[1];
}

function parseBoundaryValue(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

export function parseGeoJsonPolygon(value: unknown): ParsedPolygon | null {
  const boundary = parseBoundaryValue(value);
  if (!boundary || typeof boundary !== 'object') return null;
  const candidate = boundary as { type?: unknown; coordinates?: unknown };
  if (candidate.type !== 'Polygon' || !Array.isArray(candidate.coordinates) || candidate.coordinates.length === 0) return null;

  const rings: [number, number][][] = [];
  let vertexCount = 0;
  for (const rawRing of candidate.coordinates) {
    if (!Array.isArray(rawRing) || rawRing.length < 4) return null;
    const coordinates = rawRing as unknown[];
    const first = coordinates[0];
    const last = coordinates[coordinates.length - 1];
    if (!Array.isArray(first) || !Array.isArray(last) || !sameCoordinate(first as number[], last as number[])) return null;

    const ring: [number, number][] = [];
    for (const rawCoordinate of coordinates.slice(0, -1)) {
      if (!Array.isArray(rawCoordinate) || rawCoordinate.length < 2) return null;
      const [longitude, latitude] = rawCoordinate;
      if (!isFiniteCoordinate(longitude) || !isFiniteCoordinate(latitude)) return null;
      if (longitude < -180 || longitude > 180 || latitude < -90 || latitude > 90) return null;
      ring.push([latitude, longitude]);
    }
    if (ring.length < 3) return null;
    const uniqueCoordinates = new Set(ring.map(([latitude, longitude]) => `${latitude}:${longitude}`));
    if (uniqueCoordinates.size < 3) return null;
    vertexCount += ring.length;
    rings.push(ring);
  }
  return { rings, vertexCount };
}

export function createGeoJsonPolygon(points: MapPoint[]): GeoJsonPolygon {
  const ring = points.map(point => [point.lng, point.lat]);
  return { type: 'Polygon', coordinates: [[...ring, [...ring[0]]]] };
}

export function geodesicAreaHectares(points: MapPoint[]) {
  if (points.length < 3) return 0;
  let area = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    area += (next.lng - current.lng) * DEGREES_TO_RADIANS
      * (2 + Math.sin(current.lat * DEGREES_TO_RADIANS) + Math.sin(next.lat * DEGREES_TO_RADIANS));
  }
  return Math.abs(area * EARTH_RADIUS_METERS * EARTH_RADIUS_METERS / 2) / 10_000;
}

function orientation(first: MapPoint, second: MapPoint, third: MapPoint) {
  return (second.lng - first.lng) * (third.lat - first.lat) - (second.lat - first.lat) * (third.lng - first.lng);
}

function segmentsIntersect(a: MapPoint, b: MapPoint, c: MapPoint, d: MapPoint) {
  const first = orientation(a, b, c);
  const second = orientation(a, b, d);
  const third = orientation(c, d, a);
  const fourth = orientation(c, d, b);
  const onSegment = (start:MapPoint, point:MapPoint, end:MapPoint) => point.lng >= Math.min(start.lng,end.lng)-INTERSECTION_EPSILON
    && point.lng <= Math.max(start.lng,end.lng)+INTERSECTION_EPSILON
    && point.lat >= Math.min(start.lat,end.lat)-INTERSECTION_EPSILON
    && point.lat <= Math.max(start.lat,end.lat)+INTERSECTION_EPSILON;
  if (first * second < 0 && third * fourth < 0) return true;
  if (Math.abs(first)<=INTERSECTION_EPSILON&&onSegment(a,c,b)) return true;
  if (Math.abs(second)<=INTERSECTION_EPSILON&&onSegment(a,d,b)) return true;
  if (Math.abs(third)<=INTERSECTION_EPSILON&&onSegment(c,a,d)) return true;
  return Math.abs(fourth)<=INTERSECTION_EPSILON&&onSegment(c,b,d);
}

export function polygonHasSelfIntersections(points: MapPoint[]) {
  if (points.length < 4) return false;
  for (let firstIndex = 0; firstIndex < points.length; firstIndex += 1) {
    const firstNext = (firstIndex + 1) % points.length;
    for (let secondIndex = firstIndex + 1; secondIndex < points.length; secondIndex += 1) {
      const secondNext = (secondIndex + 1) % points.length;
      if (firstIndex === secondIndex || firstNext === secondIndex || secondNext === firstIndex) continue;
      if (segmentsIntersect(points[firstIndex], points[firstNext], points[secondIndex], points[secondNext])) return true;
    }
  }
  return false;
}

export function canAddVertex(points: MapPoint[]) {
  return points.length < MAX_EDITOR_VERTICES;
}

export function vertexAlreadyExists(points:MapPoint[],candidate:MapPoint) {
  return points.some(point=>Math.abs(point.lat-candidate.lat)<1e-8&&Math.abs(point.lng-candidate.lng)<1e-8);
}
