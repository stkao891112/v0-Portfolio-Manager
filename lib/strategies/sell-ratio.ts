/**
 * 停利「累計賣出 %」→ 比例。剛好 100% 存 1（避免浮點誤差）；
 * 超過 100 的非法輸入不截斷，原樣換算後交給後端驗證退回。
 */
export function sellPercentToRatio(sellPercent: number | string): number {
  const n = Number(sellPercent)
  return Math.abs(n - 100) < 1e-9 ? 1 : n / 100
}
