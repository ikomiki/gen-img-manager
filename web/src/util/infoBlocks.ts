export type InfoBlockKey = "prompt" | "negative" | "params";

export interface InfoBlock {
  key: InfoBlockKey;
  label: string;
  text: string;
  /** 整形トグルの対象か。生の parameters は書式そのものに意味があるので整形しない。 */
  normalizable: boolean;
}

/** positive があれば Prompt/Negative、無ければ解析前の Parameters を出す（デスクトップ版と同じ）。 */
export function buildInfoBlocks(d: {
  positive: string | null;
  negative: string | null;
  raw_parameters: string | null;
}): InfoBlock[] {
  const blocks: InfoBlock[] = [];
  if (d.positive) blocks.push({ key: "prompt", label: "Prompt", text: d.positive, normalizable: true });
  if (d.negative)
    blocks.push({ key: "negative", label: "Negative", text: d.negative, normalizable: true });
  if (!d.positive && d.raw_parameters)
    blocks.push({ key: "params", label: "Parameters", text: d.raw_parameters, normalizable: false });
  return blocks;
}
