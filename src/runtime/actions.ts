export interface ActionRecord {
  id: number;
  name: string;
  args: unknown[];
  timestamp: string;
}
export interface ActionFunction<
  Args extends unknown[] = unknown[],
  Result = void,
> {
  (...args: Args): Result;
  actionName: string;
  calls: Args[];
  clear(): void;
}
let records: ActionRecord[] = [];
let sequence = 0;
let limit = 500;
const listeners = new Set<() => void>();
export function serializable(
  value: unknown,
  seen = new WeakSet(),
  depth = 0,
): unknown {
  if (typeof value === 'string' && value.length > 20_000)
    return value.slice(0, 20_000) + '…';
  if (value === undefined) return '[undefined]';
  if (typeof value === 'function')
    return `[Function ${value.name || 'anonymous'}]`;
  if (typeof value === 'bigint') return `${String(value)}n`;
  if (typeof value === 'symbol') return String(value);
  if (typeof value !== 'object' || value === null) return value;
  if (depth > 7) return '[Max depth]';
  if (seen.has(value)) return '[Circular]';
  seen.add(value);
  if (value instanceof Error)
    return { name: value.name, message: value.message };
  if (value instanceof Date) return value.toISOString();
  if (
    'nativeEvent' in value ||
    (typeof Event !== 'undefined' && value instanceof Event)
  ) {
    const event = value as {
      type?: string;
      detail?: unknown;
      target?: { value?: unknown; checked?: unknown; tagName?: string };
    };
    return {
      type: event.type,
      ...('detail' in event
        ? { detail: serializable(event.detail, seen, depth + 1) }
        : {}),
      target: event.target
        ? {
            tag: event.target.tagName,
            value: event.target.value,
            checked: event.target.checked,
          }
        : null,
    };
  }
  if (typeof Element !== 'undefined' && value instanceof Element)
    return `<${value.tagName.toLowerCase()}${value.id ? `#${value.id}` : ''}>`;
  if (Array.isArray(value))
    return value.map((item) => serializable(item, seen, depth + 1));
  if (value instanceof Map)
    return [...value].map(([key, item]) => [
      serializable(key, seen, depth + 1),
      serializable(item, seen, depth + 1),
    ]);
  if (value instanceof Set)
    return [...value].map((item) => serializable(item, seen, depth + 1));
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      serializable(item, seen, depth + 1),
    ]),
  );
}
export function logAction(name: string, ...args: unknown[]) {
  const entry = {
    id: ++sequence,
    name,
    args: args.map((value) => {
      try {
        return serializable(value);
      } catch {
        return '[Unserializable]';
      }
    }),
    timestamp: new Date().toISOString(),
  };
  records = [...records.slice(Math.max(0, records.length - limit + 1)), entry];
  for (const listener of listeners) listener();
  return entry;
}
export function action<Args extends unknown[] = unknown[], Result = void>(
  name: string,
  implementation?: (...args: Args) => Result,
): ActionFunction<Args, Result> {
  const calls: Args[] = [];
  const callback = ((...args: Args) => {
    calls.push(args);
    logAction(name, ...args);
    return implementation?.(...args) as Result;
  }) as ActionFunction<Args, Result>;
  callback.actionName = name;
  callback.calls = calls;
  callback.clear = () => {
    calls.splice(0);
  };
  return callback;
}
export const spy = action;
export function configureActions(options: { limit?: number }) {
  limit = Math.max(1, Math.min(5000, options.limit ?? 500));
}
export function clearActions() {
  records = [];
  for (const listener of listeners) listener();
}
export const getActions = () => records;
export function subscribeActions(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
