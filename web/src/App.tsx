import { useEffect, useState } from "react";
import { getJson } from "./api/client";

export function App() {
  const [health, setHealth] = useState<string>("...");

  useEffect(() => {
    getJson<{ schema_version: number; image_count: number }>("/api/health")
      .then((h) => setHealth(`schema ${h.schema_version} / ${h.image_count} 枚`))
      .catch((e) => setHealth(`エラー: ${e.message}`));
  }, []);

  return <p style={{ padding: 16 }}>{health}</p>;
}
