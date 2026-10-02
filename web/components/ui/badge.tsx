import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const badgeVariants = cva("inline-flex items-center rounded-lg px-2.5 py-1 text-xs font-medium", {
  variants: {
    variant: {
      default: "bg-[#4a9d9a]/10 text-[#4a9d9a]",
      secondary: "bg-gray-100 text-gray-500",
      warning: "bg-[#e8b86d]/10 text-[#c17767]",
    },
  },
  defaultVariants: {
    variant: "default",
  },
});

function Badge({
  className,
  variant,
  ...props
}: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return <span data-slot="badge" className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
