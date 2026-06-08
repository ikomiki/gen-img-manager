import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";

export interface MenuItem {
  label: string;
  shortcut?: string;
  onClick: () => void;
}

export type MenuEntry = MenuItem | { separator: true };

interface Props {
  x: number;
  y: number;
  items: MenuEntry[];
  onClose: () => void;
}

const MENU_W = 200;
const MENU_H = 160;

export function ContextMenu({ x, y, items, onClose }: Props) {
  const ref = useRef<HTMLUListElement>(null);

  const left = x + MENU_W > window.innerWidth ? x - MENU_W : x;
  const top = y + MENU_H > window.innerHeight ? y - MENU_H : y;

  useEffect(() => {
    const onMouseDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const onScroll = () => onClose();
    window.addEventListener("mousedown", onMouseDown);
    window.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      window.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [onClose]);

  return createPortal(
    <ul ref={ref} className="context-menu" style={{ left, top }} role="menu">
      {items.map((item, i) => {
        if ("separator" in item) {
          return <li key={i} className="context-menu-separator" role="separator" />;
        }
        return (
          <li key={i} role="menuitem">
            <button onClick={item.onClick}>
              <span>{item.label}</span>
              {item.shortcut && <kbd>{item.shortcut}</kbd>}
            </button>
          </li>
        );
      })}
    </ul>,
    document.body,
  );
}
