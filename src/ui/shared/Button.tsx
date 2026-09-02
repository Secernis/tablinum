import type { ComponentProps } from "react";

import { cn } from "@/utils/cn";

interface ButtonProps extends ComponentProps<"button"> {
  /** `primary` carries the brand accent; `quiet` sits on a surface without competing with it. */
  variant?: "primary" | "quiet";
}

/**
 * The app's button, in the two weights it needs.
 *
 * One component rather than utility classes at every call site, so the focus
 * ring and the disabled state are decided once.
 */
export function Button({ variant = "quiet", className, type = "button", ...props }: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        "inline-flex items-center gap-2 rounded-full border px-4 py-1.5 text-sm transition",
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-focus",
        "disabled:cursor-not-allowed disabled:opacity-50",
        variant === "primary"
          ? "border-accent bg-accent text-on-accent hover:opacity-90"
          : "border-line bg-raised text-ink hover:border-accent",
        className,
      )}
      {...props}
    />
  );
}
