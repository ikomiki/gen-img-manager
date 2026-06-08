import { useState } from "react";

interface ContextMenuState {
  open: boolean;
  x: number;
  y: number;
  imageId: number | null;
}

export function useContextMenu() {
  const [menuState, setMenuState] = useState<ContextMenuState>({
    open: false,
    x: 0,
    y: 0,
    imageId: null,
  });

  const showMenu = (x: number, y: number, imageId: number) =>
    setMenuState({ open: true, x, y, imageId });

  const closeMenu = () => setMenuState((s) => ({ ...s, open: false }));

  return { menuState, showMenu, closeMenu };
}
