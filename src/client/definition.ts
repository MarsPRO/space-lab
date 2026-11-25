import { useMemo } from 'react';
import type { ComponentDocumentation, Control } from '../index.js';
import { useSite } from '../react.js';
import { asRecord } from '../runtime/data.js';
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- The runtime registry holds heterogeneous consumer prop definitions.
export type RuntimeDocumentation = ComponentDocumentation<any>;
export function useDocumentation(
  of: RuntimeDocumentation,
): RuntimeDocumentation {
  const { entries } = useSite();
  const entry = entries.find(
    (entry) =>
      entry.kind === 'examples' &&
      JSON.stringify(entry.title) === JSON.stringify(of.title),
  );
  return useMemo(() => {
    const inferred: Record<string, Control> = {};
    const args = asRecord(of.args);
    for (const [key, value] of Object.entries(args)) {
      if (typeof value === 'function' || value === undefined || value === null)
        continue;
      inferred[key] = {
        type:
          typeof value === 'boolean'
            ? 'boolean'
            : typeof value === 'number'
              ? 'number'
              : typeof value === 'string'
                ? 'text'
                : 'json',
      };
    }
    const api = of.api ?? entry?.api ?? [],
      controls = {
        ...inferred,
        ...Object.fromEntries(
          api.flatMap((prop) =>
            prop.control ? [[prop.name, prop.control]] : [],
          ),
        ),
        ...of.controls,
      };
    const includedControls = Object.fromEntries(
      Object.entries(controls).filter(
        ([key]) => !of.excludeControls?.includes(key),
      ),
    );
    return {
      ...of,
      api,
      controls: includedControls,
      subcomponentApi: of.subcomponentApi ?? entry?.subcomponentApi ?? {},
    };
  }, [of, entry]);
}
