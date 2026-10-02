import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * 弹层开合的公共逻辑：
 * - 点击外部 / Esc 关闭
 * - 打开前测量视口剩余空间：下方放不下就向上翻（up），右侧放不下就右对齐（end）
 */
export function usePopover(estimatedHeight: number, estimatedWidth: number) {
  const [open, setOpen] = useState(false);
  const [flip, setFlip] = useState(false);
  const [end, setEnd] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const openPopover = useCallback(() => {
    const rect = rootRef.current?.getBoundingClientRect();
    if (rect) {
      const below = window.innerHeight - rect.bottom;
      setFlip(below < estimatedHeight + 8 && rect.top > below);
      setEnd(rect.left + estimatedWidth > window.innerWidth - 8);
    }
    setOpen(true);
  }, [estimatedHeight, estimatedWidth]);

  const toggle = useCallback(() => {
    if (open) {
      setOpen(false);
      return;
    }
    openPopover();
  }, [open, openPopover]);

  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent): void => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return { open, flip, end, rootRef, openPopover, toggle, close };
}
