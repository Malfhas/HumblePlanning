import { handleApiError } from "@/lib/utils/api";
import { verifySecondFactor } from "@/lib/services/two-factor-login-service";
import { crossOriginRejection } from "@/lib/utils/csrf";

export async function POST(request: Request) {
  const rejected = await crossOriginRejection(request);
  if (rejected) return rejected;
  try {
    return await verifySecondFactor(request);
  } catch (error) {
    return handleApiError(error);
  }
}
