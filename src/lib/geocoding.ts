import { z } from 'zod';

const geocodingSchema = z.object({
  results: z.array(z.object({
    id: z.number(), name: z.string(), latitude: z.number(), longitude: z.number(),
    country: z.string().optional(), admin1: z.string().optional(), admin2: z.string().optional(),
  })).optional(),
});

export type PlaceResult = { id: number; name: string; latitude: number; longitude: number; label: string };

export async function searchPlaces(term: string, signal?: AbortSignal): Promise<PlaceResult[]> {
  const query = term.trim();
  if (query.length < 2) return [];
  const params = new URLSearchParams({ name: query, count: '6', language: 'es', format: 'json' });
  const response = await fetch(`https://geocoding-api.open-meteo.com/v1/search?${params}`, { signal });
  if (!response.ok) throw new Error(`El buscador geográfico respondió ${response.status}`);
  const parsed = geocodingSchema.safeParse(await response.json());
  if (!parsed.success) throw new Error('El buscador devolvió un formato inesperado');
  return (parsed.data.results ?? []).map(place => ({
    id: place.id, name: place.name, latitude: place.latitude, longitude: place.longitude,
    label: [place.name, place.admin2, place.admin1, place.country].filter(Boolean).filter((value,index,all)=>all.indexOf(value)===index).join(', '),
  }));
}
