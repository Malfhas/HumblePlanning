"use client";

import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { Loader2 } from 'lucide-react';
import { cn } from "@/lib/utils";
import { Tooltip } from './misc';

/** Buttons (Plane scale: 24/28/32px, flat variants, brand accent). */
export const buttonVariants = cva(
  'inline-flex items-center justify-center gap-1.5 rounded-ai-md font-medium transition-colors disabled:pointer-events-none disabled:opacity-50 whitespace-nowrap select-none cursor-pointer focus-visible:outline-none',
  {
    variants: {
      variant: {
        primary: 'bg-ai-accent text-ai-on-accent hover:bg-ai-accent-hover',
        secondary:
          'bg-ai-surface text-ai-secondary border-[0.5px] border-ai-border-strong shadow-ai-raised hover:bg-ai-surface-hover hover:text-ai-primary',
        ghost: 'text-ai-secondary hover:bg-ai-surface-hover hover:text-ai-primary',
        danger: 'bg-ai-danger-solid text-ai-on-accent hover:bg-ai-danger-solid-hover',
        // Serious but reversible action - archive, not delete
        warning: 'bg-ai-warning-solid text-ai-on-accent hover:bg-ai-warning-solid-hover',
        link: 'text-ai-link underline-offset-4 hover:underline p-0 h-auto',
      },
      // On phone, a button is tapped with a finger: 36 px for the small ones,
      // 40 px for the regular and large sizes
      size: {
        sm: 'h-6 px-2 text-ai-xs max-md:min-h-9',
        md: 'h-7 px-2.5 text-ai-sm max-md:min-h-10',
        lg: 'h-8 px-3 text-ai-sm max-md:min-h-10',
        icon: 'h-7 w-7 p-0 max-md:min-h-9 max-md:min-w-9',
      },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  },
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, loading, disabled, children, type, title, ...props }, ref) => {
    const button = (
      <button
        ref={ref}
        type={type ?? 'button'}
        className={cn(buttonVariants({ variant, size }), className)}
        disabled={disabled || loading}
        aria-label={typeof title === 'string' ? title : undefined}
        {...props}
      >
        {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : null}
        {children}
      </button>
    );
    // A `title` becomes a themed tooltip (Plane pattern: every icon button is described)
    return title ? <Tooltip content={title}>{button}</Tooltip> : button;
  },
);
Button.displayName = 'Button';
