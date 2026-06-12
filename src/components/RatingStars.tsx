import { ratingStarFills } from "../util/ratingStars";

const FILLED_COLOR = "#ffce3d";
const EMPTY_COLOR = "rgba(255, 255, 255, 0.45)";

/**
 * レーティングを5つ星で表示する（読み取り専用）。塗り＝金の★、空＝グレーの☆。
 * 色のみインラインで自己完結し、font-size 等のサイズ・配置は親コンテナの CSS で制御する。
 * （メイン／スライドショーで読み込まれるスタイルシートが異なるため。）
 */
export function RatingStars({ rating }: { rating: number | null }) {
  const fills = ratingStarFills(rating);
  return (
    <span role="img" aria-label={`レーティング ${rating ?? 0}`} style={{ whiteSpace: "nowrap" }}>
      {fills.map((filled, i) => (
        <span key={i} style={{ color: filled ? FILLED_COLOR : EMPTY_COLOR }}>
          {filled ? "★" : "☆"}
        </span>
      ))}
    </span>
  );
}
