import * as React from "react";

import { cn } from "@/lib/utils";

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "h-10 w-full rounded-xl border border-gray-200 bg-[#faf8f5] px-4 py-2 text-sm text-gray-800 outline-none transition-all placeholder:text-gray-400 focus:border-[#4a9d9a] focus:ring-2 focus:ring-[#4a9d9a]/30 disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}

export { Input };
