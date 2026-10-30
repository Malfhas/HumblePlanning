import { NextRequest, NextResponse } from "next/server";
import { getConfigValue } from "@/lib/services/config-service";
import {
  verifyNuntlySignature,
  logWebhookEvent,
  updateNuntlyLastReceived,
  checkWebhookRateLimit,
} from "@/lib/services/webhook-service";
import { blockEmail } from "@/lib/services/email-blocklist-service";
import { logAudit } from "@/lib/services/audit-service";
import { getClientIp } from "@/lib/utils/rate-limit";

export const dynamic = "force-dynamic";

interface BouncedRecipient {
  email?: string;
  status?: string;
  diagnosticCode?: string;
}

interface ComplainedRecipient {
  email?: string;
}

interface NuntlyEvent {
  id?: string;
  type: string;
  data?: {
    id?: string;
    messageId?: string;
    to?: string | string[];
    bounce?: {
      bounceType?: string;
      bounceSubType?: string;
      bouncedRecipients?: BouncedRecipient[];
    };
    complaint?: {
      complainedRecipients?: ComplainedRecipient[];
      complaintFeedbackType?: string;
    };
  };
}

export async function POST(request: NextRequest) {
  // Rate limiting
  const ip = getClientIp(request.headers);

  if (!checkWebhookRateLimit(ip)) {
    await logWebhookEvent({
      provider: "nuntly",
      eventType: "rate_limited",
      status: "rate_limited",
      errorMessage: `Rate limit exceeded for IP ${ip}`,
    });
    return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });
  }

  // Read raw body (required for HMAC)
  let rawBody: string;
  try {
    rawBody = await request.text();
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  // Verify signature
  const signature = request.headers.get("webhook-signature");
  const secret = (await getConfigValue("NUNTLY_WEBHOOK_SECRET")) || "";
  const verification = verifyNuntlySignature(rawBody, signature, secret);

  if (!verification.valid) {
    await logWebhookEvent({
      provider: "nuntly",
      eventType: "unknown",
      status: "invalid_signature",
      errorMessage: verification.reason,
      payload: rawBody.slice(0, 1000),
    });
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  // Parse JSON
  let event: NuntlyEvent;
  try {
    event = JSON.parse(rawBody);
  } catch {
    await logWebhookEvent({
      provider: "nuntly",
      eventType: "unknown",
      status: "error",
      errorMessage: "Invalid JSON",
      payload: rawBody.slice(0, 1000),
    });
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const eventType = event.type ?? "unknown";
  const eventId = event.id ?? event.data?.id ?? null;
  const messageId = event.data?.messageId ?? null;
  const recipientFromTo = Array.isArray(event.data?.to)
    ? event.data.to[0]
    : event.data?.to;

  // Always log received event
  await logWebhookEvent({
    provider: "nuntly",
    eventType,
    eventId,
    recipient: recipientFromTo,
    messageId,
    status: "received",
    payload: event,
  });

  await updateNuntlyLastReceived();

  try {
    if (eventType === "email.bounced") {
      const bounceType = event.data?.bounce?.bounceType ?? "";
      const isPermanent = bounceType.toLowerCase() === "permanent";
      const recipients = event.data?.bounce?.bouncedRecipients ?? [];

      if (isPermanent) {
        for (const r of recipients) {
          if (!r.email) continue;
          await blockEmail(
            r.email,
            "bounce",
            `${r.status ?? ""} ${r.diagnosticCode ?? ""}`.trim() || undefined,
            "nuntly",
          );
          await logAudit({
            userId: null,
            action: "email_blocked",
            entityType: "email",
            entityId: null,
            metadata: {
              email: r.email,
              reason: "bounce",
              bounceType,
              source: "nuntly",
              messageId,
            },
          });
        }
      }
    } else if (eventType === "email.complained") {
      const recipients = event.data?.complaint?.complainedRecipients ?? [];
      const feedbackType = event.data?.complaint?.complaintFeedbackType;
      for (const r of recipients) {
        if (!r.email) continue;
        await blockEmail(
          r.email,
          "complaint",
          feedbackType,
          "nuntly",
        );
        await logAudit({
          userId: null,
          action: "email_blocked",
          entityType: "email",
          entityId: null,
          metadata: {
            email: r.email,
            reason: "complaint",
            feedbackType,
            source: "nuntly",
            messageId,
          },
        });
      }
    }
  } catch (err) {
    await logWebhookEvent({
      provider: "nuntly",
      eventType,
      eventId,
      recipient: recipientFromTo,
      messageId,
      status: "error",
      errorMessage: err instanceof Error ? err.message : String(err),
    });
    // Still return 200 to avoid Nuntly retries on our internal error
  }

  // Return 200 even for ignored events (delivered, opened, etc.) — prevents retries
  return NextResponse.json({ ok: true });
}
