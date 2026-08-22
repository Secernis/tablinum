import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Merge class names; on conflict the last one wins.
 *
 * TailGrids components expect this helper at `@/utils/cn` — the CLI does not
 * ship it, it assumes it exists. `twMerge` is the reason a `className="bg-accent"
 * from the outside overrides a component's built-in background instead of
 * stacking with it.
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
