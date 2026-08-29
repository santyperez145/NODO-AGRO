import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';

const schema = z.object({
  current: z.object({ temperature_2m: z.number(), relative_humidity_2m: z.number(), precipitation: z.number(), wind_speed_10m: z.number() }),
  daily: z.object({ precipitation_sum: z.array(z.number().nullable()) }),
});

export type AgroWeather = { temperature: number; humidity: number; precipitationNow: number; wind: number; rain7d: number; source: string };

export function useAgroWeather(latitude?: number, longitude?: number) {
  const resolvedLatitude = latitude ?? Number(import.meta.env.VITE_FARM_LATITUDE ?? '-33.8913');
  const resolvedLongitude = longitude ?? Number(import.meta.env.VITE_FARM_LONGITUDE ?? '-60.5736');
  return useQuery<AgroWeather>({
    queryKey: ['weather', resolvedLatitude, resolvedLongitude],
    enabled: Number.isFinite(resolvedLatitude) && Number.isFinite(resolvedLongitude),
    queryFn: async ({ signal }) => {
      const params = new URLSearchParams({ latitude: String(resolvedLatitude), longitude: String(resolvedLongitude), current: 'temperature_2m,relative_humidity_2m,precipitation,wind_speed_10m', daily: 'precipitation_sum', timezone: 'auto', forecast_days: '7' });
      const response = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`, { signal });
      if (!response.ok) throw new Error(`Open-Meteo respondió ${response.status}`);
      const parsed = schema.safeParse(await response.json());
      if (!parsed.success) throw new Error('Open-Meteo devolvió un contrato inesperado');
      return {
        temperature: parsed.data.current.temperature_2m,
        humidity: parsed.data.current.relative_humidity_2m,
        precipitationNow: parsed.data.current.precipitation,
        wind: parsed.data.current.wind_speed_10m,
        rain7d: parsed.data.daily.precipitation_sum.reduce<number>((sum, value) => sum + (value ?? 0), 0),
        source: `Open-Meteo · ${resolvedLatitude.toFixed(4)}, ${resolvedLongitude.toFixed(4)}`,
      };
    },
  });
}
