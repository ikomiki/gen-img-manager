interface Props {
  items: string[];
  selected: number;
  onPick: (q: string) => void;
}

export function HistoryList({ items, selected, onPick }: Props) {
  if (items.length === 0) return null;

  return (
    <ul
      style={{
        listStyle: "none",
        margin: 0,
        padding: 0,
        maxHeight: "50vh",
        overflowY: "auto",
        background: "var(--surface-raised)",
        borderBottom: "1px solid var(--border)",
      }}
    >
      {items.map((h, i) => (
        <li key={h}>
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onPick(h)}
            style={{
              display: "block",
              width: "100%",
              minHeight: "var(--tap)",
              textAlign: "left",
              padding: "0 12px",
              border: "none",
              background: i === selected ? "var(--accent)" : "transparent",
              color: "var(--text)",
              font: "inherit",
              cursor: "pointer",
            }}
          >
            {h}
          </button>
        </li>
      ))}
    </ul>
  );
}
