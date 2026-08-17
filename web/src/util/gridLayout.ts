export interface GridLayout {
  columns: number;
  cell: number;
}

/** グリッドの列数とセル幅を算出する。width は測定前は 0 になり得る。 */
export function gridLayout(width: number, minCell: number, gap: number): GridLayout {
  const columns = Math.max(1, Math.floor((width + gap) / (minCell + gap)));
  const cell = columns > 0 ? (width - gap * (columns - 1)) / columns : minCell;
  return { columns, cell };
}
