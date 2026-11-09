import { appBaseUrl, buildMailRequest, getMailConfig, passwordResetEmail, resetDelivery, sendMail } from "../lib/mail";

const brevo = { MAIL_PROVIDER: "brevo", MAIL_API_KEY: "key-123", MAIL_FROM: "noreply@example.com" };

describe("getMailConfig", () => {
  it("is null when any setting is missing", () => {
    expect(getMailConfig({})).toBeNull();
    expect(getMailConfig({ ...brevo, MAIL_API_KEY: "" })).toBeNull();
    expect(getMailConfig({ ...brevo, MAIL_FROM: undefined })).toBeNull();
    expect(getMailConfig({ ...brevo, MAIL_PROVIDER: undefined })).toBeNull();
  });

  it("is null for a provider it does not know", () => {
    expect(getMailConfig({ ...brevo, MAIL_PROVIDER: "carrier-pigeon" })).toBeNull();
  });

  it("reads a complete setup, ignoring case and spaces, with a default sender name", () => {
    expect(getMailConfig({ ...brevo, MAIL_PROVIDER: " Brevo " })).toEqual({
      provider: "brevo",
      apiKey: "key-123",
      fromEmail: "noreply@example.com",
      fromName: "SecureLedger",
    });
  });

  it("uses MAIL_FROM_NAME when given", () => {
    expect(getMailConfig({ ...brevo, MAIL_FROM_NAME: "Acme Books" })?.fromName).toBe("Acme Books");
  });
});

describe("appBaseUrl", () => {
  it("returns only the origin, without a path or trailing slash", () => {
    expect(appBaseUrl({ APP_BASE_URL: "https://app.example.com/some/path/" })).toBe("https://app.example.com");
  });

  it("is null when unset, malformed or not http(s)", () => {
    expect(appBaseUrl({})).toBeNull();
    expect(appBaseUrl({ APP_BASE_URL: "not a url" })).toBeNull();
    expect(appBaseUrl({ APP_BASE_URL: "javascript:alert(1)" })).toBeNull();
  });
});

describe("resetDelivery", () => {
  const configured = { ...brevo, APP_BASE_URL: "https://app.example.com" };

  it("emails the link when mail and the base URL are set, in any environment", () => {
    expect(resetDelivery({ ...configured, NODE_ENV: "production" })).toBe("email");
    expect(resetDelivery({ ...configured, NODE_ENV: "development" })).toBe("email");
  });

  it("returns the link on screen only outside production", () => {
    expect(resetDelivery({ NODE_ENV: "development" })).toBe("link");
    expect(resetDelivery({})).toBe("link");
  });

  it("creates no link at all in production without a working email setup", () => {
    expect(resetDelivery({ NODE_ENV: "production" })).toBe("unavailable");
  });

  it("treats a missing base URL as not set up, so a link is never built from a request header", () => {
    expect(resetDelivery({ ...brevo, NODE_ENV: "production" })).toBe("unavailable");
  });

  it("treats a missing API key as not set up", () => {
    expect(resetDelivery({ ...configured, MAIL_API_KEY: "", NODE_ENV: "production" })).toBe("unavailable");
  });
});

describe("buildMailRequest", () => {
  const message = { to: "pat@example.com", subject: "Hello", text: "Body" };

  it("builds a Brevo request", () => {
    const cfg = getMailConfig(brevo)!;
    const req = buildMailRequest(cfg, message);
    expect(req.url).toBe("https://api.brevo.com/v3/smtp/email");
    expect(req.headers["api-key"]).toBe("key-123");
    expect(req.body).toEqual({
      sender: { name: "SecureLedger", email: "noreply@example.com" },
      to: [{ email: "pat@example.com" }],
      subject: "Hello",
      textContent: "Body",
    });
  });

  it("builds a Resend request", () => {
    const cfg = getMailConfig({ ...brevo, MAIL_PROVIDER: "resend" })!;
    const req = buildMailRequest(cfg, message);
    expect(req.url).toBe("https://api.resend.com/emails");
    expect(req.headers.authorization).toBe("Bearer key-123");
    expect(req.body).toEqual({
      from: "SecureLedger <noreply@example.com>",
      to: ["pat@example.com"],
      subject: "Hello",
      text: "Body",
    });
  });
});

describe("sendMail", () => {
  const cfg = getMailConfig(brevo)!;
  const message = { to: "pat@example.com", subject: "Hello", text: "Body" };

  it("posts the request to the provider", async () => {
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, status: 201 });
    await sendMail(cfg, message, fetchMock as unknown as typeof fetch);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.brevo.com/v3/smtp/email");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body).to).toEqual([{ email: "pat@example.com" }]);
  });

  it("throws when the provider rejects the message, without leaking the API key", async () => {
    const fetchMock = jest.fn().mockResolvedValue({ ok: false, status: 401 });
    await expect(sendMail(cfg, message, fetchMock as unknown as typeof fetch)).rejects.toThrow(
      "Mail provider brevo returned HTTP 401"
    );
    await sendMail(cfg, message, fetchMock as unknown as typeof fetch).catch((e) => {
      expect(String(e.message)).not.toContain("key-123");
    });
  });

  it("passes network errors on", async () => {
    const fetchMock = jest.fn().mockRejectedValue(new Error("network down"));
    await expect(sendMail(cfg, message, fetchMock as unknown as typeof fetch)).rejects.toThrow("network down");
  });
});

describe("passwordResetEmail", () => {
  it("contains the link once, the name and the expiry, and tells the reader what to do if they did not ask", () => {
    const { subject, text } = passwordResetEmail("Pat", "https://app.example.com/reset-password?token=abc");
    expect(subject).toMatch(/reset/i);
    expect(text).toContain("Hello Pat");
    expect(text.split("https://app.example.com/reset-password?token=abc").length - 1).toBe(1);
    expect(text).toContain("1 hour");
    expect(text).toContain("did not ask");
  });
});
