import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-semibold backdrop-blur transition-colors focus:outline-none",
  {
    variants: {
      variant: {
        default: "border-transparent bg-gradient-animated text-white shadow-glow",
        secondary: "border-transparent bg-secondary text-secondary-foreground",
        destructive: "border-transparent bg-destructive/90 text-destructive-foreground",
        outline: "border-white/15 text-foreground",
        success:
          "border-emerald-400/20 bg-emerald-500/10 text-emerald-300",
        warning: "border-amber-400/20 bg-amber-500/10 text-amber-300",
        info: "border-sky-400/20 bg-sky-500/10 text-sky-300",
        muted: "border-transparent bg-muted text-muted-foreground",
      },
    },
    defaultVariants: { variant: "default" },
  }
);

export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };