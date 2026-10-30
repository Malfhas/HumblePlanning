"use client";

export function ChartLegend({ payload }: any) {
  if (!payload?.length) return null;
  return (
    <div className="flex flex-wrap justify-center gap-x-3 gap-y-1 mt-2">
      {payload.map((entry: any, i: number) => (
        <span key={i} className="flex items-center gap-1 text-[10px] text-muted-foreground">
          <span className="inline-block h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: entry.color }} />
          {entry.value}
        </span>
      ))}
    </div>
  );
}
