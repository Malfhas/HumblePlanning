"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { Check, X } from "lucide-react";
import { evaluatePassword, type PasswordPolicy } from "@/lib/password-policy";
import { tDyn } from "@/i18n/dynamic";

interface Props {
  password: string;
  policy: PasswordPolicy;
}

const SEGMENT_COLORS = ["#ef4444", "#f97316", "#84cc16", "#22c55e"];

// i18n-dynamic: validation.password.*
export function PasswordStrengthBar({ password, policy }: Props) {
  const t = useTranslations("validation");
  const strength = useMemo(
    () => evaluatePassword(password, policy),
    [password, policy]
  );

  if (!password) return null;

  return (
    <div className="space-y-2">
      {/* Bar + label */}
      <div className="flex items-center gap-2">
        <div className="flex flex-1 gap-1 h-1.5">
          {SEGMENT_COLORS.map((color, i) => (
            <div
              key={i}
              className="flex-1 rounded-full transition-colors duration-200"
              style={{
                backgroundColor: i < strength.score ? color : "hsl(var(--muted))",
              }}
            />
          ))}
        </div>
        {strength.scoreKey && (
          <span
            className="text-xs font-medium whitespace-nowrap"
            style={{ color: strength.color }}
          >
            {tDyn(t, `password.score.${strength.scoreKey}`)}
          </span>
        )}
      </div>

      {/* Checks list */}
      <ul className="space-y-0.5">
        {strength.checks.map((check) => (
          <li key={check.key} className="flex items-center gap-1.5 text-xs">
            {check.met ? (
              <Check className="h-3 w-3 text-green-500 shrink-0" />
            ) : (
              <X className="h-3 w-3 text-red-500 shrink-0" />
            )}
            <span className={check.met ? "text-muted-foreground" : "text-foreground"}>
              {tDyn(t, `password.${check.key}`, check.params)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
