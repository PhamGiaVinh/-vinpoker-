import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { Button, type ButtonProps } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

const glassCardVariants = cva(
  [
    "group relative isolate overflow-hidden",
    "border-white/[0.12] bg-background/45 backdrop-blur-xl",
    "shadow-[0_16px_42px_-28px_rgba(0,255,136,0.5),inset_0_1px_0_rgba(255,255,255,0.12)]",
  ].join(" "),
  {
    variants: {
      glassSize: {
        sm: "p-4",
        default: "p-6",
        lg: "p-8",
      },
    },
    defaultVariants: { glassSize: "default" },
  },
);

export type LiquidGlassCardProps = React.HTMLAttributes<HTMLDivElement> &
  VariantProps<typeof glassCardVariants> & {
    contentClassName?: string;
  };

/**
 * Local VinPoker adaptation of KokonutUI's liquid-glass surface.
 * It is presentation-only: no data, state or business authority lives here.
 */
export function LiquidGlassCard({
  className,
  contentClassName,
  glassSize,
  children,
  ...props
}: LiquidGlassCardProps) {
  return (
    <Card className={cn(glassCardVariants({ glassSize }), className)} {...props}>
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-5 top-0 h-px bg-white/25"
      />
      <span
        aria-hidden="true"
        className="pointer-events-none absolute -right-10 -top-14 h-32 w-32 rounded-full bg-primary/[0.09] blur-2xl"
      />
      <div className={cn("relative z-10", contentClassName)}>{children}</div>
    </Card>
  );
}

export type LiquidButtonProps = ButtonProps & {
  liquidMotion?: boolean;
};

/**
 * Keeps the existing Button API and handlers intact while adding a restrained
 * glass material. Semantic colours supplied by callers still win.
 */
export function LiquidButton({
  className,
  liquidMotion = true,
  children,
  ...props
}: LiquidButtonProps) {
  return (
    <Button
      className={cn(
        "relative isolate overflow-hidden border-white/[0.14] bg-white/[0.055] backdrop-blur-xl",
        "shadow-[inset_0_1px_0_rgba(255,255,255,0.13),0_12px_30px_-24px_rgba(0,255,136,0.7)]",
        "before:pointer-events-none before:absolute before:inset-x-2 before:top-0 before:h-px before:bg-white/30",
        "after:pointer-events-none after:absolute after:-right-6 after:-top-8 after:h-16 after:w-16 after:rounded-full after:bg-primary/[0.10] after:blur-xl",
        "hover:bg-white/[0.09] focus-visible:ring-primary/70",
        liquidMotion &&
          "transition-[transform,background-color,border-color] duration-150 active:scale-[0.98] motion-reduce:transform-none",
        className,
      )}
      {...props}
    >
      <span className="relative z-10 inline-flex items-center justify-center gap-2">
        {children}
      </span>
    </Button>
  );
}
