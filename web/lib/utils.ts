import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * 合并条件类名，并解决 Tailwind 工具类冲突；这是 shadcn/ui 组件统一开放样式覆盖的基础。
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
