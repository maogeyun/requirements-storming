/** i-pple 口径：座位对外展示名，永不暴露内部 id */
export const SEAT_ROLE_LABELS = ["产品", "设计", "研发", "测试", "运营"] as const;

export function formatSeatDisplayName(seatIndex: number): string {
  const role = SEAT_ROLE_LABELS[seatIndex] ?? `席位${seatIndex + 1}`;
  return `座位 ${seatIndex + 1} / ${role}`;
}
