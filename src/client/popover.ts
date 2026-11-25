import { useLayoutEffect, useState } from 'react';
import type { CSSProperties, RefObject } from 'react';
export function usePopover(
  anchor: RefObject<HTMLElement | null>,
  width: number,
  open: boolean,
): CSSProperties {
  const [position, setPosition] = useState({ left: 8, top: 38 });
  useLayoutEffect(() => {
    if (!open) return;
    const update = () => {
      const box = anchor.current?.getBoundingClientRect();
      if (box)
        setPosition({
          left: Math.max(8, Math.min(innerWidth - width - 8, box.left)),
          top: Math.max(8, Math.min(innerHeight - 180, box.bottom + 4)),
        });
    };
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [open, width]);
  return {
    position: 'fixed',
    left: position.left,
    top: position.top,
    width,
    maxWidth: 'calc(100vw - 16px)',
    maxHeight: `calc(100dvh - ${String(position.top + 8)}px)`,
    overflowY: 'auto',
    zIndex: 100,
  };
}
