interface Route {
  id: string;
  aliases?: string[];
}

// Resolve against the full index, before filtering by kind. An old bookmark
// must not silently change destination when a companion page is added.
export function resolveRoute<T extends Route>(
  entries: readonly T[],
  ref: string | null | undefined,
): T | undefined {
  if (typeof ref !== 'string' || !ref) return undefined;
  const candidates = ref.includes(':')
    ? [ref]
    : [`doc:${ref}`, `examples:${ref}`];
  const matches = entries.filter((entry) =>
    candidates.some((id) => entry.id === id || entry.aliases?.includes(id)),
  );
  return matches.length === 1 ? matches[0] : undefined;
}
