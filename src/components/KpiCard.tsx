import type { LucideIcon } from "lucide-react";

const COLOR_CLASSES = {
  red: "bg-red-100 text-red-600 dark:bg-red-900/40 dark:text-red-400",
  blue: "bg-blue-100 text-blue-600 dark:bg-blue-900/40 dark:text-blue-400",
  green: "bg-green-100 text-green-600 dark:bg-green-900/40 dark:text-green-400",
  amber: "bg-amber-100 text-amber-600 dark:bg-amber-900/40 dark:text-amber-400",
} as const;

export function KpiCard({
  label,
  value,
  caption,
  icon: Icon,
  color,
}: {
  label: string;
  value: string;
  caption?: string;
  icon: LucideIcon;
  color: keyof typeof COLOR_CLASSES;
}) {
  return (
    <div className="rounded-xl border border-foreground/10 bg-background shadow-sm p-4">
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm text-foreground/60">{label}</p>
        <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${COLOR_CLASSES[color]}`}>
          <Icon size={18} strokeWidth={2} />
        </span>
      </div>
      <p className="mt-1 text-2xl font-semibold">{value}</p>
      {caption && <p className="mt-1 text-xs text-foreground/50">{caption}</p>}
    </div>
  );
}
