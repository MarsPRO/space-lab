import { useRef } from 'react';
import type { ReactNode, PointerEvent } from 'react';
import { useLabels, useI18n } from '../react.js';
import { readState, updatePreviewState } from './shared.js';
import { Icon } from './icons.js';

export interface InspectorTab {
  id: string;
  title: string;
  count?: number;
  content: ReactNode;
}
export function Inspector({
  tabs,
  active,
  actions,
}: {
  tabs: InspectorTab[];
  active: string;
  actions?: ReactNode;
}) {
  const labels = useLabels(),
    state = readState();
  const dock = state.get('dock') === 'right' ? 'right' : 'bottom';
  const i18n = useI18n();
  const size = Math.max(
    160,
    Math.min(
      900,
      dock === 'right' ? innerWidth - 80 : innerHeight - 80,
      Number(state.get('panelSize')) || (dock === 'right' ? 420 : 310),
    ),
  );
  const element = useRef<HTMLElement>(null);
  const selected = tabs.find((tab) => tab.id === active);
  function resize(event: PointerEvent<HTMLDivElement>) {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const start = dock === 'right' ? event.clientX : event.clientY;
    const move = (moveEvent: globalThis.PointerEvent) => {
      const next = Math.max(
        160,
        Math.min(
          dock === 'right' ? innerWidth - 100 : innerHeight - 80,
          size +
            start -
            (dock === 'right' ? moveEvent.clientX : moveEvent.clientY),
        ),
      );
      if (element.current)
        element.current.style[dock === 'right' ? 'width' : 'height'] =
          `${String(next)}px`;
      updatePreviewState({ panelSize: String(Math.round(next)) }, true);
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
  if (!selected) return null;
  return (
    <section
      ref={element}
      className="lab-inspector"
      data-dock={dock}
      style={
        dock === 'right' ? { width: size, height: '100%' } : { height: size }
      }
      aria-label={selected.title}
    >
      <div
        className="lab-panel-resizer"
        role="separator"
        tabIndex={0}
        aria-label={labels.resizePanel}
        aria-orientation={dock === 'right' ? 'vertical' : 'horizontal'}
        aria-valuemin={160}
        aria-valuemax={900}
        aria-valuenow={size}
        onPointerDown={resize}
        onDoubleClick={() => {
          updatePreviewState({ panelSize: '' }, true);
        }}
        onKeyDown={(event) => {
          if (
            ['ArrowUp', 'ArrowLeft', 'ArrowDown', 'ArrowRight'].includes(
              event.key,
            )
          ) {
            event.preventDefault();
            updatePreviewState(
              {
                panelSize: String(
                  Math.max(
                    160,
                    Math.min(
                      900,
                      size +
                        (['ArrowUp', 'ArrowLeft'].includes(event.key)
                          ? 20
                          : -20),
                    ),
                  ),
                ),
              },
              true,
            );
          }
        }}
      />
      <div className="lab-inspector-bar">
        <div role="tablist" aria-label={labels.panels}>
          {tabs.map((tab) => (
            <button
              key={tab.id}
              id={`lab-tab-${tab.id}`}
              role="tab"
              aria-selected={active === tab.id}
              aria-controls={`lab-panel-${tab.id}`}
              tabIndex={active === tab.id ? 0 : -1}
              onClick={() => {
                updatePreviewState({ panel: tab.id });
              }}
              onKeyDown={(event) => {
                if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
                  event.preventDefault();
                  const next =
                    tabs[
                      (tabs.indexOf(tab) +
                        (event.key === 'ArrowRight' ? 1 : tabs.length - 1)) %
                        tabs.length
                    ];
                  updatePreviewState({ panel: next.id });
                  requestAnimationFrame(() =>
                    document.getElementById(`lab-tab-${next.id}`)?.focus(),
                  );
                }
              }}
            >
              {tab.title}
              {tab.count !== undefined && (
                <span aria-hidden="true">{i18n.number(tab.count)}</span>
              )}
            </button>
          ))}
        </div>
        <div className="lab-inspector-actions">
          {actions}
          <button
            title={dock === 'right' ? labels.dockBottom : labels.dockRight}
            aria-label={dock === 'right' ? labels.dockBottom : labels.dockRight}
            onClick={() => {
              updatePreviewState({
                dock: dock === 'right' ? 'bottom' : 'right',
                panelSize: '',
              });
            }}
          >
            <Icon name={dock === 'right' ? 'dock-bottom' : 'dock-right'} />
          </button>
          <button
            aria-label={labels.closePanel}
            title={labels.closePanel}
            onClick={() => {
              updatePreviewState({ panel: '' });
            }}
          >
            <Icon name="close" />
          </button>
        </div>
      </div>
      <div
        className="lab-inspector-content"
        role="tabpanel"
        id={`lab-panel-${active}`}
        aria-labelledby={`lab-tab-${active}`}
      >
        {selected.content}
      </div>
    </section>
  );
}
