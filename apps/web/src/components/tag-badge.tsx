import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

interface TagBadgeProps {
  name: string;
  size?: "sm" | "md";
  active?: boolean;
  onClick?: () => void;
  onRemove?: () => void;
  className?: string;
}

export function TagBadge({ name, size = "md", active, onClick, onRemove, className }: TagBadgeProps) {
  const badge = (
    <Badge
      variant="secondary"
      className={cn(
        "bg-[oklch(94%_0.04_25)] text-[oklch(42%_0.12_25)] border-[oklch(86%_0.06_25)] hover:bg-[oklch(90%_0.06_25)] dark:bg-[oklch(20%_0.04_25)] dark:text-[oklch(72%_0.10_25)] dark:border-[oklch(30%_0.06_25)] dark:hover:bg-[oklch(24%_0.05_25)]",
        size === "sm" ? "px-2 py-0 text-xs h-5 max-w-24" : "px-2.5 py-0.5 text-sm h-6",
        onClick && "cursor-pointer hover:bg-[oklch(88%_0.07_25)] dark:hover:bg-[oklch(28%_0.06_25)]",
        active && "bg-[oklch(82%_0.10_25)] text-[oklch(28%_0.10_25)] border-[oklch(72%_0.12_25)] dark:bg-[oklch(38%_0.09_25)] dark:text-[oklch(95%_0.04_25)] dark:border-[oklch(50%_0.10_25)]",
        className
      )}
      onClick={onClick ? (e) => {
        e.preventDefault();
        e.stopPropagation();
        onClick();
      } : undefined}
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
          className="ml-0.5 rounded-full hover:bg-[oklch(80%_0.08_25)] hover:text-[oklch(35%_0.14_25)] dark:hover:bg-[oklch(32%_0.07_25)] dark:hover:text-[oklch(85%_0.12_25)] transition-colors p-0.5 -mr-1 shrink-0"
          aria-label={`Remove ${name} tag`}
        >
          <X className={size === "sm" ? "w-3 h-3" : "w-3.5 h-3.5"} />
        </button>
      )}
    </Badge>
  );

  if (onClick) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>{badge}</TooltipTrigger>
        <TooltipContent>{active ? "Remove from tag filter" : "Add to tag filter"}</TooltipContent>
      </Tooltip>
    );
  }

  return badge;
}
