"use client";

import { forwardRef, type InputHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { cn } from "@/lib/utils";

/** Text fields (Plane recipe: thin 0.5px border, 13px, accent focus). */
const baseClasses =
  'w-full rounded-ai-md border-[0.5px] border-ai-border-default bg-ai-surface px-2.5 text-ai-sm text-ai-primary placeholder:text-ai-placeholder focus-visible:border-ai-border-focus focus-visible:outline-none disabled:opacity-50 disabled:cursor-not-allowed transition-colors';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    // Phone: 40 px, a finger's height, with room for the 16 px font from app.css
    <input ref={ref} className={cn(baseClasses, 'h-8 max-md:h-10', className)} {...props} />
  ),
);
Input.displayName = 'Input';

export const Textarea = forwardRef<
  HTMLTextAreaElement,
  TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => (
  <textarea ref={ref} className={cn(baseClasses, 'min-h-[72px] py-2', className)} {...props} />
));
Textarea.displayName = 'Textarea';
