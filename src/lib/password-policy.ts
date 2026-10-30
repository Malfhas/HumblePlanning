export interface PasswordPolicy {
  minLength: number;
  maxLength: number;
  requireUppercase: boolean;
  requireLowercase: boolean;
  requireDigit: boolean;
  requireSpecial: boolean;
}

export interface PasswordCheck {
  /** Message key under `validation.password` (minLength, maxLength, uppercase…): `t(\`validation.password.${key}\`, params)`. */
  key: PasswordCheckKey;
  params?: Record<string, number>;
  met: boolean;
}

// i18n-dynamic: validation.password.*
export type PasswordCheckKey ="minLength" | "maxLength" | "uppercase" | "lowercase" | "digit" | "special";
export type PasswordScoreKey = "weak" | "medium" | "strong" | "veryStrong";

export interface PasswordStrength {
  score: 0 | 1 | 2 | 3 | 4;
  /** Key under `validation.password.score` (null when the score is 0). */
  scoreKey: PasswordScoreKey | null;
  color: string;
  checks: PasswordCheck[];
  valid: boolean;
}

export const DEFAULT_POLICY: PasswordPolicy = {
  minLength: 8,
  maxLength: 128,
  requireUppercase: true,
  requireLowercase: true,
  requireDigit: true,
  requireSpecial: false,
};

const PWD_CONFIG_KEYS = [
  "PWD_MIN_LENGTH",
  "PWD_MAX_LENGTH",
  "PWD_REQUIRE_UPPERCASE",
  "PWD_REQUIRE_LOWERCASE",
  "PWD_REQUIRE_DIGIT",
  "PWD_REQUIRE_SPECIAL",
  "PWD_GEN_LENGTH",
  "PWD_GEN_INCLUDE_SPECIAL",
  "PWD_HISTORY_COUNT",
  "PWD_BLACKLIST_ENABLED",
  "PWD_BLACKLIST",
] as const;

export { PWD_CONFIG_KEYS };

export function policyFromConfig(config: Record<string, string | null>): PasswordPolicy {
  return {
    minLength: parseInt(config.PWD_MIN_LENGTH ?? "") || DEFAULT_POLICY.minLength,
    maxLength: parseInt(config.PWD_MAX_LENGTH ?? "") || DEFAULT_POLICY.maxLength,
    requireUppercase: (config.PWD_REQUIRE_UPPERCASE ?? "true") === "true",
    requireLowercase: (config.PWD_REQUIRE_LOWERCASE ?? "true") === "true",
    requireDigit: (config.PWD_REQUIRE_DIGIT ?? "true") === "true",
    requireSpecial: (config.PWD_REQUIRE_SPECIAL ?? "false") === "true",
  };
}

const SCORE_LEVELS: Record<number, { key: PasswordScoreKey | null; color: string }> = {
  0: { key: null, color: "" },
  1: { key: "weak", color: "#ef4444" },
  2: { key: "medium", color: "#f97316" },
  3: { key: "strong", color: "#84cc16" },
  4: { key: "veryStrong", color: "#22c55e" },
};

export function evaluatePassword(password: string, policy: PasswordPolicy): PasswordStrength {
  if (!password) {
    return { score: 0, scoreKey: null, color: "", checks: [], valid: false };
  }

  const checks: PasswordCheck[] = [];

  checks.push({
    key: "minLength",
    params: { min: policy.minLength },
    met: password.length >= policy.minLength,
  });

  if (policy.maxLength < 999) {
    checks.push({
      key: "maxLength",
      params: { max: policy.maxLength },
      met: password.length <= policy.maxLength,
    });
  }

  if (policy.requireUppercase) {
    checks.push({ key: "uppercase", met: /[A-Z]/.test(password) });
  }

  if (policy.requireLowercase) {
    checks.push({ key: "lowercase", met: /[a-z]/.test(password) });
  }

  if (policy.requireDigit) {
    checks.push({ key: "digit", met: /\d/.test(password) });
  }

  if (policy.requireSpecial) {
    checks.push({ key: "special", met: /[^A-Za-z0-9]/.test(password) });
  }

  const valid = checks.every((c) => c.met);
  const metCount = checks.filter((c) => c.met).length;

  // Score: ratio of met checks + bonus for extra length
  let rawScore = checks.length > 0 ? (metCount / checks.length) * 3 : 0;
  if (password.length >= 16) rawScore += 1;
  else if (password.length >= 12) rawScore += 0.5;

  const score = Math.min(4, Math.max(0, Math.round(rawScore))) as 0 | 1 | 2 | 3 | 4;
  const { key: scoreKey, color } = SCORE_LEVELS[score];

  return { score, scoreKey, color, checks, valid };
}
