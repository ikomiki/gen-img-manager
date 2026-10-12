/**
 * クリップボードへ書く。成功したら true。
 * LAN の http://192.168.x.x は安全なコンテキストではなく navigator.clipboard が無いため、
 * 非推奨の execCommand("copy") へ落とす。HTTP 上で iOS Safari を含めて動くのはこれしかない。
 */
export async function copyText(text: string): Promise<boolean> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // 権限で拒否されることもあるので、下の経路も試す。
    }
  }
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.setAttribute("readonly", "");
  // 画面外に置かないと、iOS で選択時に画面がスクロールしたりキーボードが出たりする。
  ta.style.position = "fixed";
  ta.style.top = "-1000px";
  document.body.appendChild(ta);
  try {
    ta.select();
    ta.setSelectionRange(0, text.length);
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    ta.remove();
  }
}
