import { verifyCaptcha } from "@/lib/captcha";
import { AppError, handleApiError } from "@/lib/utils/api";
import { signInWithPassword } from "@/lib/services/password-login-service";
import { crossOriginRejection } from "@/lib/utils/csrf";

export async function POST(request: Request) {
  const rejected = await crossOriginRejection(request);
  if (rejected) return rejected;
  const body = await request.json();
  const { identifier, password, captchaToken, rememberMe } = body;

  if (typeof identifier !== "string" || typeof password !== "string" || !identifier || !password) {
    return handleApiError(new AppError("auth.errors.credentialsRequired"));
  }

  // Verify captcha
  try {
    await verifyCaptcha(captchaToken);
  } catch (err) {
    return handleApiError(err instanceof AppError ? err : new AppError("auth.errors.captchaFailed"));
  }

  return signInWithPassword(request, { identifier, password, rememberMe });
}
