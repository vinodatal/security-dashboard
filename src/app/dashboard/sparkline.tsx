"use client";

export function Sparkline({ data, color = "#3b82f6", height = 32, width = 120 }: {
  data: number[];
  color?: string;
  height?: number;
  width?: number;
}) {
  if (data.length < 2) return null;

  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const padding = 2;

  const points = data.map((v, i) => {
    const x = (i / (data.length - 1)) * (width - padding * 2) + padding;
    const y = height - padding - ((v - min) / range) * (height - padding * 2);
    return `${x},${y}`;
  }).join(" ");

  const trend = data[data.length - 1] - data[0];
  const trendColor = trend > 0 ? "#22c55e" : trend < 0 ? "#ef4444" : "#6b7280";

  return (
    <div className="flex items-center gap-2">
      <svg width={width} height={height} className="overflow-visible">
        <polyline
          points={points}
          fill="none"
          stroke={color}
          strokeWidth={1.5}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <span className="text-xs font-medium" style={{ color: trendColor }}>
        {trend > 0 ? "↑" : trend < 0 ? "↓" : "→"}
        {Math.abs(Math.round(trend))}
      </span>
    </div>
  );
}
