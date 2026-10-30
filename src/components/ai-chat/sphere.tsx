"use client";

import { cn } from "@/lib/utils";

/**
 * Custom animated sphere - a nebula in pure CSS, with no image or library.
 * It reuses the colors of the application AI tools so the register
 * is recognised at once, and breathes slowly rather than
 * blinking: neither a home page nor a login screen should demand
 * attention. Shared by the chat and the login page.
 *
 * `glass`: the matter fades and only an empty glass ball remains,
 * to read what it covers (the floating assistant enables it after three
 * seconds of still hover).
 */
export function Sphere({ className, glass = false }: { className?: string; glass?: boolean }) {
  return (
    <div className={cn('sphere-ia', glass && 'sphere-ia--verre', className)} aria-hidden>
      <span className="sphere-ia__halo" />
      <span className="sphere-ia__corps">
        <span className="sphere-ia__nebuleuse">
          <span className="sphere-ia__masse sphere-ia__masse--a" />
          <span className="sphere-ia__masse sphere-ia__masse--b" />
          <span className="sphere-ia__masse sphere-ia__masse--c" />
          <span className="sphere-ia__masse sphere-ia__masse--d" />
        </span>
        <span className="sphere-ia__eclat" />
        <span className="sphere-ia__verre" />
      </span>
      {/* Waves at rest: they only start on hover */}
      <span className="sphere-ia__onde" />
      <span className="sphere-ia__onde sphere-ia__onde--retard" />
    </div>
  );
}
