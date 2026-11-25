import { resolveRoute } from './routes.js';
import { isRecord, asRecord } from './data.js';

export function objectValue(raw: string | null): Record<string, unknown> {
  if (!raw || raw.length > 1_000_000) return {};
  try {
    const value: unknown = JSON.parse(raw);
    if (!isRecord(value)) return {};
    let nodes = 0;
    const clean = (item: unknown, depth: number): unknown => {
      if (++nodes > 10_000 || depth > 32)
        throw new Error('URL JSON exceeds structural limits.');
      if (Array.isArray(item))
        return item.map((child: unknown) => clean(child, depth + 1));
      if (isRecord(item))
        return Object.fromEntries(
          Object.entries(item)
            .filter(
              ([key]) =>
                !['__proto__', 'prototype', 'constructor'].includes(key),
            )
            .map(([key, child]) => [key, clean(child, depth + 1)]),
        );
      return item;
    };
    return asRecord(clean(value, 0));
  } catch {
    return {};
  }
}
export function argsFromUrl(
  state: URLSearchParams,
  page: string,
  example: string,
  entries?: readonly { id: string }[],
): Record<string, unknown> {
  const record = objectValue(state.get('args'));
  const owner = entries
    ? resolveRoute(
        entries,
        typeof record.page === 'string' ? record.page : undefined,
      )?.id
    : record.page;
  return owner === page && record.example === example && isRecord(record.values)
    ? record.values
    : {};
}
export function argsToUrl(
  page: string,
  example: string,
  values: Record<string, unknown>,
): string {
  return JSON.stringify({ page, example, values }, (_key, value: unknown) =>
    typeof value === 'function' || typeof value === 'symbol'
      ? undefined
      : typeof value === 'bigint'
        ? String(value)
        : value,
  );
}
