/**
 * Outgoing email for password resets.
 *
 * Sends over a provider's HTTPS API and not SMTP, because some hosts (Render among them)
 * block outbound SMTP ports. Two providers are supported, each with a free tier:
 * "brevo" and "resend". Nothing here needs a library.
 *
 * Environment:
 *   MAIL_PROVIDER   "brevo" or "resend"
 *   MAIL_API_KEY    the provider's API key (a secret)
 *   MAIL_FROM       the sender address, which the provider must have verified
 *   MAIL_FROM_NAME  optional display name, default "SecureLedger"
 *   APP_BASE_URL    the public address of this app, for example https://app.example.com
 */

export type MailProvider = "brevo" | "resend";

export type MailConfig = {
  provider: MailProvider;
  apiKey: string;
  fromEmail: string;
  fromName: string;
};

export type MailMessage = { to: string; subject: string; text: string };

type Env = Record<string, string | undefined>;

/** The mail settings, or null when email is not set up (or the provider name is not recognised). */
export function getMailConfig(env: Env = process.env): MailConfig | null {
  const provider = env.MAIL_PROVIDER?.trim().toLowerCase();
  const apiKey = env.MAIL_API_KEY?.trim();
  const fromEmail = env.MAIL_FROM?.trim();
  if (!provider || !apiKey || !fromEmail) return null;
  if (provider !== "brevo" && provider !== "resend") return null;
  return { provider, apiKey, fromEmail, fromName: env.MAIL_FROM_NAME?.trim() || "SecureLedger" };
}

/**
 * The public origin of this app, used to build links sent by email. It is read from the
 * environment and never from the request, because a request's Host header can be set by
 * whoever sends it, which would let them point a reset link at a site they control.
 */
export function appBaseUrl(env: Env = process.env): string | null {
  const raw = env.APP_BASE_URL?.trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return url.protocol === "https:" || url.protocol === "http:" ? url.origin : null;
  } catch {
    return null;
  }
}

/**
 * How a password-reset link reaches the person who asked for it:
 *  - "email": it is sent to the account's address, and is never shown to the requester.
 *  - "link": it is returned in the response. Only allowed outside production, as a development
 *    convenience. In production this would let anyone reset any account whose email they know.
 *  - "unavailable": production with no working email setup, so no link is created at all.
 */
export type ResetDelivery = "email" | "link" | "unavailable";

export function resetDelivery(env: Env = process.env): ResetDelivery {
  if (getMailConfig(env) && appBaseUrl(env)) return "email";
  return env.NODE_ENV === "production" ? "unavailable" : "link";
}

/** The provider-specific HTTP request for a message. Separate from sending so it can be tested. */
export function buildMailRequest(
  config: MailConfig,
  message: MailMessage
): { url: string; headers: Record<string, string>; body: Record<string, unknown> } {
  if (config.provider === "brevo") {
    return {
      url: "https://api.brevo.com/v3/smtp/email",
      headers: { "api-key": config.apiKey, "content-type": "application/json", accept: "application/json" },
      body: {
        sender: { name: config.fromName, email: config.fromEmail },
        to: [{ email: message.to }],
        subject: message.subject,
        textContent: message.text,
      },
    };
  }
  return {
    url: "https://api.resend.com/emails",
    headers: { authorization: `Bearer ${config.apiKey}`, "content-type": "application/json" },
    body: {
      from: `${config.fromName} <${config.fromEmail}>`,
      to: [message.to],
      subject: message.subject,
      text: message.text,
    },
  };
}

/** Sends one message. Throws if the provider rejects it or does not answer within 10 seconds. */
export async function sendMail(config: MailConfig, message: MailMessage, fetchImpl: typeof fetch = fetch): Promise<void> {
  const request = buildMailRequest(config, message);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetchImpl(request.url, {
      method: "POST",
      headers: request.headers,
      body: JSON.stringify(request.body),
      signal: controller.signal,
    });
    // The response body is not included: it is not needed and could echo request details.
    if (!res.ok) throw new Error(`Mail provider ${config.provider} returned HTTP ${res.status}`);
  } finally {
    clearTimeout(timer);
  }
}

export function passwordResetEmail(name: string, link: string): { subject: string; text: string } {
  return {
    subject: "Reset your SecureLedger password",
    text:
      `Hello ${name},\n\n` +
      `Someone asked to reset the password for your SecureLedger account. ` +
      `To choose a new password, open this link within 1 hour. It can be used once:\n\n` +
      `${link}\n\n` +
      `If you did not ask for this, you can ignore this email. Your password will not change.\n\n` +
      `SecureLedger`,
  };
}
