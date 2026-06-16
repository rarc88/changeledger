const EMPTY_SLUG = 'slug must contain at least one ASCII letter or number';

export function slugify(value) {
  const slug = String(value ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (!slug) throw new Error(EMPTY_SLUG);
  return slug;
}
