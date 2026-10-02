import * as React from "react";

import { cn } from "@/lib/utils";

function Progress({
  className,
  indicatorClassName,
  value = 0,
  ...props
}: React.ComponentProps<"div"> & {
  indicatorClassName?: string;
  value?: number;
}) {
  const normalizedValue = Math.min(100, Math.max(0, value));

  return (
    <div
      data-slot="progress"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={normalizedValue}
      className={cn("relative h-2 w-full overflow-hidden rounded-full bg-gray-100", className)}
      {...props}
    >
      <div
        data-slot="progress-indicator"
        className={cn("h-full rounded-full bg-[#4a9d9a] transition-all duration-500", indicatorClassName)}
        style={{ width: `${normalizedValue}%` }}
      />
    </div>
  );
}

export { Progress };
