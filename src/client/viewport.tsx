import { useEffect, useRef, useState } from 'react';
import type { ReactNode, PointerEvent } from 'react';
import { config } from 'virtual:space-lab/site';
import { useLabels, useText } from '../react.js';
import type { Locale } from '../i18n/locale.js';
import type { Viewport } from '../index.js';
import { Icon } from './icons.js';

import { usePopover } from './popover.js';

type ViewportPreset = Omit<Viewport, 'name'> & Partial<Pick<Viewport, 'name'>>;
export const viewports: Partial<Record<string, ViewportPreset>> = {
  mobile: { width: 375, height: 667 },
  phone: { width: 430, height: 932 },
  tablet: { width: 768, height: 1024 },
  desktop: { width: 1280, height: 800 },
  ...config.viewports,
};
const dimension = (value: string | number | null, fallback: number) =>
  Math.max(240, Math.min(4000, Number(value) || fallback));
export function viewportDimensions(state: URLSearchParams) {
  const preset = viewports[state.get('viewport') ?? ''];
  if (!preset && state.get('viewport') !== 'custom') return null;
  const width = dimension(state.get('width'), preset?.width ?? 375),
    height = dimension(state.get('height'), preset?.height ?? 667);
  return state.get('rotate') === '1'
    ? { width: height, height: width }
    : { width, height };
}
export function ViewportControl({
  state,
  locale,
  update,
}: {
  state: URLSearchParams;
  locale: Locale;
  update: (values: Record<string, string>, replace?: boolean) => void;
}) {
  const [open, setOpen] = useState(false),
    labels = useLabels(),
    dimensions = viewportDimensions(state);
  const anchor = useRef<HTMLDivElement>(null),
    text = useText(),
    position = usePopover(anchor, 250, open);
  const [widthText, setWidthText] = useState(String(dimensions?.width ?? 375)),
    [heightText, setHeightText] = useState(String(dimensions?.height ?? 667));
  useEffect(() => {
    setWidthText(String(dimensions?.width ?? 375));
    setHeightText(String(dimensions?.height ?? 667));
  }, [dimensions?.width, dimensions?.height]);
  const applyDimensions = () => {
    update(
      {
        viewport: 'custom',
        width: String(dimension(widthText, dimensions?.width ?? 375)),
        height: String(dimension(heightText, dimensions?.height ?? 667)),
        rotate: '',
      },
      true,
    );
  };
  return (
    <div
      ref={anchor}
      className="lab-viewport-control"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
    >
      <button
        className="lab-icon-button"
        title={labels.viewportSize}
        aria-label={labels.viewportSize}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-pressed={!!dimensions}
        onClick={() => {
          setOpen(!open);
        }}
      >
        <Icon name="viewport" />
      </button>
      {open && (
        <div
          className="lab-viewport-menu"
          style={position}
          role="menu"
          aria-label={labels.viewportSize}
        >
          <button
            role="menuitemradio"
            aria-checked={!dimensions}
            onClick={() => {
              update({ viewport: '', width: '', height: '', rotate: '' });
              setOpen(false);
            }}
          >
            {labels.responsive}
          </button>
          {Object.entries(viewports).flatMap(([id, preset]) =>
            preset
              ? [
                  <button
                    key={id}
                    role="menuitemradio"
                    aria-checked={state.get('viewport') === id}
                    onClick={() => {
                      update({
                        viewport: id,
                        width: '',
                        height: '',
                        rotate: '',
                      });
                      setOpen(false);
                    }}
                  >
                    {Object.hasOwn(config.viewports ?? {}, id)
                      ? text(preset.name, locale)
                      : ({
                          mobile: labels.deviceMobile,
                          phone: labels.devicePhone,
                          tablet: labels.deviceTablet,
                          desktop: labels.deviceDesktop,
                        }[id] ?? text(preset.name, locale))}{' '}
                    <small>
                      {preset.width} × {preset.height}
                    </small>
                  </button>,
                ]
              : [],
          )}
          <div className="lab-viewport-custom">
            <strong>{labels.custom}</strong>
            <label>
              {labels.width}
              <input
                type="number"
                min={240}
                max={4000}
                aria-label={labels.width}
                value={widthText}
                onChange={(event) => {
                  setWidthText(event.target.value);
                }}
                onBlur={applyDimensions}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') applyDimensions();
                }}
              />
            </label>
            <label>
              {labels.height}
              <input
                type="number"
                min={240}
                max={4000}
                aria-label={labels.height}
                value={heightText}
                onChange={(event) => {
                  setHeightText(event.target.value);
                }}
                onBlur={applyDimensions}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') applyDimensions();
                }}
              />
            </label>
            <button
              disabled={!dimensions}
              onClick={() => {
                update({ rotate: state.get('rotate') === '1' ? '' : '1' });
              }}
            >
              {labels.rotate}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
export function ViewportFrame({
  state,
  update,
  children,
}: {
  state: URLSearchParams;
  update: (values: Record<string, string>, replace?: boolean) => void;
  locale: Locale;
  children: ReactNode;
}) {
  const dimensions = viewportDimensions(state);
  const labels = useLabels();
  function resize(event: PointerEvent<HTMLButtonElement>) {
    if (!dimensions) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const startX = event.clientX,
      startY = event.clientY;
    const move = (current: globalThis.PointerEvent) => {
      update(
        {
          viewport: 'custom',
          width: String(
            Math.round(
              dimension(
                dimensions.width + current.clientX - startX,
                dimensions.width,
              ),
            ),
          ),
          height: String(
            Math.round(
              dimension(
                dimensions.height + current.clientY - startY,
                dimensions.height,
              ),
            ),
          ),
          rotate: '',
        },
        true,
      );
    };
    const end = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
  }
  return (
    <div
      className={`lab-preview-host ${dimensions ? 'is-sized' : ''}`}
      style={
        dimensions
          ? { width: dimensions.width, height: dimensions.height }
          : undefined
      }
    >
      {children}
      {dimensions && (
        <button
          className="lab-viewport-resizer"
          title={labels.resizeViewport}
          aria-label={labels.resizeViewport}
          onPointerDown={resize}
          onKeyDown={(event) => {
            const delta = event.shiftKey ? 50 : 10;
            if (
              ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(
                event.key,
              )
            ) {
              event.preventDefault();
              update(
                {
                  viewport: 'custom',
                  width: String(
                    dimension(
                      dimensions.width +
                        (event.key === 'ArrowRight'
                          ? delta
                          : event.key === 'ArrowLeft'
                            ? -delta
                            : 0),
                      dimensions.width,
                    ),
                  ),
                  height: String(
                    dimension(
                      dimensions.height +
                        (event.key === 'ArrowDown'
                          ? delta
                          : event.key === 'ArrowUp'
                            ? -delta
                            : 0),
                      dimensions.height,
                    ),
                  ),
                  rotate: '',
                },
                true,
              );
            }
          }}
        >
          ◢
        </button>
      )}
    </div>
  );
}
