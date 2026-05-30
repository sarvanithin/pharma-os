"use client";

import {
  Bar,
  BarChart,
  Line,
  LineChart,
  Pie,
  PieChart,
  Cell,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import type { DataPoint } from "@/lib/analytics/query";

const COLORS = ["#4f7cff", "#22c55e", "#f59e0b", "#ef4444", "#a855f7", "#06b6d4", "#ec4899", "#84cc16"];

export function Chart({
  type,
  points,
  metricValue,
}: {
  type: string;
  points: DataPoint[];
  metricValue: number;
}) {
  if (type === "metric") {
    return (
      <div className="flex h-40 flex-col items-center justify-center">
        <span className="text-4xl font-semibold tabular-nums">
          {Math.round(metricValue * 100) / 100}
        </span>
      </div>
    );
  }

  if (type === "table") {
    return (
      <div className="max-h-64 overflow-auto">
        <table className="w-full text-sm">
          <tbody>
            {points.map((p) => (
              <tr key={p.label} className="border-b">
                <td className="py-1.5 pr-4">{p.label}</td>
                <td className="py-1.5 text-right tabular-nums">{Math.round(p.value * 100) / 100}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  if (points.length === 0) {
    return <div className="flex h-48 items-center justify-center text-sm text-muted-foreground">No data</div>;
  }

  return (
    <ResponsiveContainer width="100%" height={240}>
      {type === "line" ? (
        <LineChart data={points}>
          <XAxis dataKey="label" tick={{ fontSize: 11 }} />
          <YAxis tick={{ fontSize: 11 }} />
          <Tooltip />
          <Line type="monotone" dataKey="value" stroke={COLORS[0]} strokeWidth={2} dot={false} />
        </LineChart>
      ) : type === "pie" ? (
        <PieChart>
          <Tooltip />
          <Pie data={points} dataKey="value" nameKey="label" outerRadius={90} label>
            {points.map((_, i) => (
              <Cell key={i} fill={COLORS[i % COLORS.length]} />
            ))}
          </Pie>
        </PieChart>
      ) : (
        <BarChart data={points}>
          <XAxis dataKey="label" tick={{ fontSize: 11 }} />
          <YAxis tick={{ fontSize: 11 }} />
          <Tooltip />
          <Bar dataKey="value" radius={[4, 4, 0, 0]}>
            {points.map((_, i) => (
              <Cell key={i} fill={COLORS[i % COLORS.length]} />
            ))}
          </Bar>
        </BarChart>
      )}
    </ResponsiveContainer>
  );
}
