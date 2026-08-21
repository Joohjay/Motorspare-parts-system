/**
 * Slugifies a name for URL/identifier use (e.g. "Brake System" -> "brake-system").
 * Non-alphanumeric runs collapse to a single dash; the result is lowercase.
 */
export function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}