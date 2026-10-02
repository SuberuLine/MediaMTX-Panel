import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap text-sm font-medium transition-all disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4a9d9a]/30",
  {
    variants: {
      variant: {
        default: "bg-[#4a9d9a] text-white hover:bg-[#438e8b]",
        ghost: "text-gray-500 hover:bg-white hover:text-gray-800",
        outline: "border border-gray-200 bg-white text-gray-700 hover:bg-[#faf8f5]",
        link: "text-[#4a9d9a] underline-offset-4 hover:underline",
      },
      size: {
        default: "h-10 rounded-xl px-4 py-2",
        sm: "h-8 rounded-lg px-3 text-xs",
        icon: "h-9 w-9 rounded-xl",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  }) {
  const Comp = asChild ? Slot : "button";

  return (
    <Comp
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };
