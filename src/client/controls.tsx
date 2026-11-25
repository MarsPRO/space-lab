import { useEffect, useState } from 'react';
import type { Control } from '../index.js';
import { useLabels } from '../react.js';

export function controlText(value: unknown): string {
  // Preserve native-control coercion, including consumer-defined toString methods.
  return String(value);
}

export function controlVisible(
  control: Control,
  args: Record<string, unknown>,
  globals: Record<string, unknown>,
): boolean {
  if (!control.if) return true;
  const condition = control.if,
    value = condition.arg
      ? args[condition.arg]
      : condition.global
        ? globals[condition.global]
        : undefined;
  return 'equals' in condition
    ? Object.is(value, condition.equals)
    : Boolean(value) === (condition.truthy ?? true);
}
export function ControlInput({
  control,
  value,
  onChange,
  label,
}: {
  control: Control;
  value: unknown;
  onChange: (value: unknown) => void;
  label: string;
}) {
  const labels = useLabels();
  const [draft, setDraft] = useState(() => JSON.stringify(value ?? null));
  const [invalid, setInvalid] = useState(false);
  useEffect(() => {
    if (!invalid) setDraft(JSON.stringify(value ?? null));
  }, [value]);
  const selected = control.mapping
    ? (Object.keys(control.mapping).find((key) =>
        Object.is(control.mapping?.[key], value),
      ) ?? value)
    : value;
  const commit = (next: unknown) => {
    onChange(
      control.mapping && typeof next === 'string' && next in control.mapping
        ? control.mapping[next]
        : next,
    );
  };
  const options = control.options ?? [];
  if (control.type === 'boolean')
    return (
      <input
        type="checkbox"
        aria-label={label}
        checked={Boolean(value)}
        onChange={(event) => {
          commit(event.target.checked);
        }}
      />
    );
  if (control.type === 'radio' || control.type === 'check')
    return (
      <fieldset className="lab-choice-control">
        <legend className="lab-sr-only">{label}</legend>
        {options.map((option, index) => (
          <label key={index}>
            <input
              type={control.type === 'radio' ? 'radio' : 'checkbox'}
              name={label}
              checked={
                control.type === 'radio'
                  ? option === selected
                  : Array.isArray(value) && value.includes(option)
              }
              onChange={(event) => {
                if (control.type === 'radio') commit(option);
                else
                  commit(
                    event.target.checked
                      ? [
                          ...(Array.isArray(value) ? (value as unknown[]) : []),
                          option,
                        ]
                      : (Array.isArray(value) ? value : []).filter(
                          (item) => item !== option,
                        ),
                  );
              }}
            />
            {option}
          </label>
        ))}
      </fieldset>
    );
  if (control.type === 'select' || control.type === 'multi-select')
    return (
      <select
        multiple={control.type === 'multi-select'}
        aria-label={label}
        value={
          control.type === 'select'
            ? String(options.findIndex((option) => option === selected))
            : options.flatMap((option, index) =>
                Array.isArray(value) && value.includes(option)
                  ? [String(index)]
                  : [],
              )
        }
        onChange={(event) => {
          commit(
            control.type === 'select'
              ? options[Number(event.target.value)]
              : [...event.target.selectedOptions].map(
                  (item) => options[Number(item.value)],
                ),
          );
        }}
      >
        {options.map((option, index) => (
          <option key={index} value={index}>
            {option}
          </option>
        ))}
      </select>
    );
  if (control.type === 'json')
    return (
      <>
        <textarea
          aria-label={label}
          aria-invalid={invalid}
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value);
            try {
              commit(JSON.parse(event.target.value));
              setInvalid(false);
            } catch {
              setInvalid(true);
            }
          }}
        />
        {invalid && <small role="alert">{labels.invalidJson}</small>}
      </>
    );
  if (control.type === 'file')
    return (
      <input
        type="file"
        accept={control.accept}
        aria-label={label}
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (!file) {
            commit('');
            return;
          }
          const reader = new FileReader();
          reader.onload = () => {
            commit(reader.result);
          };
          reader.readAsDataURL(file);
        }}
      />
    );
  if (control.type === 'range')
    return (
      <span className="lab-range-control">
        <input
          type="range"
          aria-label={label}
          value={Number(value ?? 0)}
          min={control.min ?? 0}
          max={control.max ?? 100}
          step={control.step ?? 1}
          onChange={(event) => {
            commit(Number(event.target.value));
          }}
        />
        <output>{controlText(value ?? 0)}</output>
      </span>
    );
  return (
    <input
      type={
        control.type === 'number'
          ? 'number'
          : control.type === 'color'
            ? 'color'
            : control.type === 'date'
              ? 'date'
              : 'text'
      }
      aria-label={label}
      value={
        control.type === 'date' && value instanceof Date
          ? value.toISOString().slice(0, 10)
          : controlText(value ?? '')
      }
      min={control.min}
      max={control.max}
      step={control.step}
      onChange={(event) => {
        if (control.type !== 'number' || event.target.value !== '')
          commit(
            control.type === 'number'
              ? Number(event.target.value)
              : event.target.value,
          );
      }}
    />
  );
}
