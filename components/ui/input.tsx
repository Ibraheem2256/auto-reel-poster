import * as React from "react";
import { cn } from "@/lib/utils";

const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, type, ...props }, ref) => (
    <input
      type={type}
      className={cn(
        "flex h-9 w-full rounded-lg border border-white/10 bg-white/[0.03] px-3 py-1 text-sm text-foreground shadow-sm backdrop-blur transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground/70 hover:border-white/20 focus-visible:outline-none focus-visible:border-brand-violet/60 focus-visible:ring-2 focus-visible:ring-brand-violet/25 disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      ref={ref}
      {...props}
    />
  )
);
Input.displayName = "Input";

const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => (
    <textarea
      className={cn(
        "flex min-h-[60px] w-full rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-foreground shadow-sm backdrop-blur placeholder:text-muted-foreground/70 transition-colors hover:border-white/20 focus-visible:outline-none focus-visible:border-brand-violet/60 focus-visible:ring-2 focus-visible:ring-brand-violet/25 disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      ref={ref}
      {...props}
    />
  )
);
Textarea.displayName = "Textarea";

export { Input, Textarea };