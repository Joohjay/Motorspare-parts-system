export const appConfig = {
  name: 'JM SPAREPARTS',
  tagline: 'Motorcycle Spare Parts Management',
  apiUrl: (import.meta.env.VITE_API_URL ?? '/api').replace(/\/+$/, ''),
} as const;