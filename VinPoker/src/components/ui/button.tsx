import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-semibold ring-offset-background transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--accent))] focus-visible:ring-offset-2 disabled:pointer-events-none disabled:translate-y-0 disabled:opacity-45 disabled:shadow-none [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "[background:var(--gradient-sakura)] text-[var(--button-ink)] shadow-[var(--shadow-sakura)] hover:-translate-y-0.5 hover:shadow-[var(--shadow-sakura-hover)] active:translate-y-0 disabled:hover:translate-y-0",
        destructive: "bg-destructive text-destructive-foreground shadow-[var(--shadow-destructive)] hover:bg-destructive/90 hover:shadow-[var(--shadow-destructive-hover)]",
        outline: "border border-[hsl(var(--accent)_/_0.48)] bg-card/35 text-foreground hover:border-[hsl(var(--accent)_/_0.70)] hover:bg-[hsl(var(--accent)_/_0.09)] hover:text-[hsl(var(--accent))] hover:shadow-[var(--shadow-sakura-soft)] focus-visible:shadow-[var(--shadow-sakura-soft)]",
        secondary: "border border-[hsl(var(--accent)_/_0.24)] bg-secondary/85 text-secondary-foreground hover:border-[hsl(var(--accent)_/_0.42)] hover:bg-[hsl(var(--accent)_/_0.08)] hover:shadow-[var(--shadow-sakura-soft)]",
        ghost: "text-muted-foreground shadow-none hover:bg-[hsl(var(--accent)_/_0.08)] hover:text-[hsl(var(--accent))]",
        link: "text-[hsl(var(--accent))] shadow-none underline-offset-4 hover:text-[hsl(var(--accent)_/_0.86)] hover:underline",
      },
      size: {
        default: "h-10 px-4 py-2",
        sm: "h-9 rounded-md px-3",
        lg: "h-11 rounded-md px-8",
        icon: "h-10 w-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />;
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
