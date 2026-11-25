import { useEffect, useRef, useState } from 'react';
import { useLabels } from '../react.js';
interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
  tag: string;
  padding: string;
  margin: string;
  border: string;
}
const box = (element: Element): Box => {
  const rect = element.getBoundingClientRect(),
    style = getComputedStyle(element);
  return {
    x: rect.x,
    y: rect.y,
    width: rect.width,
    height: rect.height,
    tag: element.tagName.toLowerCase() + (element.id ? '#' + element.id : ''),
    padding: style.padding,
    margin: style.margin,
    border: style.borderWidth,
  };
};
export function MeasureOverlay() {
  const labels = useLabels(),
    target = useRef<Element | null>(null);
  const [hover, setHover] = useState<Box | null>(null),
    [anchor, setAnchor] = useState<Box | null>(null);
  useEffect(() => {
    let frame = 0;
    const move = (event: globalThis.PointerEvent) => {
      const element = event.target instanceof Element ? event.target : null;
      if (!element || element.closest('.lab-inspector,.lab-measure-layer')) {
        setHover(null);
        return;
      }
      target.current = element;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        setHover(box(element));
      });
    };
    const pin = (event: MouseEvent) => {
      if (event.altKey && target.current) {
        event.preventDefault();
        event.stopPropagation();
        setAnchor(box(target.current));
      }
    };
    const refresh = () => {
      if (target.current?.isConnected) setHover(box(target.current));
    };
    const clear = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setAnchor(null);
    };
    document.addEventListener('pointermove', move);
    document.addEventListener('click', pin, true);
    document.addEventListener('scroll', refresh, true);
    window.addEventListener('resize', refresh);
    window.addEventListener('keydown', clear);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener('pointermove', move);
      document.removeEventListener('click', pin, true);
      document.removeEventListener('scroll', refresh, true);
      window.removeEventListener('resize', refresh);
      window.removeEventListener('keydown', clear);
    };
  }, []);
  const distanceX =
    anchor && hover
      ? Math.max(
          0,
          anchor.x - hover.x - hover.width,
          hover.x - anchor.x - anchor.width,
        )
      : 0;
  const distanceY =
    anchor && hover
      ? Math.max(
          0,
          anchor.y - hover.y - hover.height,
          hover.y - anchor.y - anchor.height,
        )
      : 0;
  return (
    <div className="lab-measure-layer" aria-hidden={!hover}>
      <div className="lab-measure-hint">{labels.measureHint}</div>
      {anchor && (
        <div
          className="lab-measure-box is-anchor"
          style={{
            left: anchor.x,
            top: anchor.y,
            width: anchor.width,
            height: anchor.height,
          }}
        />
      )}
      {hover && (
        <>
          <div
            className="lab-measure-box"
            data-measure-target={hover.tag}
            style={{
              left: hover.x,
              top: hover.y,
              width: hover.width,
              height: hover.height,
            }}
          />
          <div
            className="lab-measure-tooltip"
            role="status"
            style={{
              left: Math.max(4, Math.min(innerWidth - 300, hover.x)),
              top: Math.max(
                4,
                Math.min(innerHeight - 120, hover.y + hover.height + 7),
              ),
            }}
          >
            <strong>
              {hover.tag} · {Math.round(hover.width * 10) / 10} ×{' '}
              {Math.round(hover.height * 10) / 10} px
            </strong>
            <span>padding: {hover.padding}</span>
            <span>
              margin: {hover.margin} · border: {hover.border}
            </span>
            {anchor && (
              <span>
                ↔ {Math.round(distanceX)} px · ↕ {Math.round(distanceY)} px
              </span>
            )}
          </div>
        </>
      )}
    </div>
  );
}
