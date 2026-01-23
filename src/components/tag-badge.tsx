import { Badge } from "@/components/ui/badge";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

interface TagBadgeProps {
  name: string;
  size?: "sm" | "md";
  onRemove?: () => void;
  className?: string;
}

export function TagBadge({ name, size = "md", onRemove, className }: TagBadgeProps) {
  return (
    <Badge
      variant="secondary"
      className={cn(
        "bg-[oklch(20%_0.04_25)] text-[oklch(72%_0.10_25)] border-[oklch(30%_0.06_25)] hover:bg-[oklch(24%_0.05_25)]",
        size === "sm" ? "px-2 py-0 text-xs h-5 max-w-24" : "px-2.5 py-0.5 text-sm h-6",
        className
      )}
    >
      <span className="truncate">{name}</span>
      {onRemove && (
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onRemove();
          }}
          className="ml-0.5 rounded-full hover:bg-[oklch(32%_0.07_25)] hover:text-[oklch(85%_0.12_25)] transition-colors p-0.5 -mr-1 shrink-0"
          aria-label={`Remove ${name} tag`}
        >
          <X className={size === "sm" ? "w-3 h-3" : "w-3.5 h-3.5"} />
        </button>
      )}
    </Badge>
  );
}
