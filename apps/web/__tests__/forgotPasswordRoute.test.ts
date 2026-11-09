/**
 * The forgot-password route, called directly with the database and the mail sender mocked.
 * What matters here is what an anonymous caller can learn from the response.
 */
const findUnique = jest.fn();
const createToken = jest.fn();
const sendMailMock = jest.fn();

jest.mock("@secureledger/db", () => ({
  prisma: {
    user: { findUnique: (...a: unknown[]) => findUnique(...a) },
    passwordResetToken: { create: (...a: unknown[]) => createToken(...a) },
  },
}));

jest.mock("../lib/mail", () => ({
  ...jest.requireActual("../lib/mail"),
  sendMail: (...a: unknown[]) => sendMailMock(...a),
}));

import { POST } from "../app/api/auth/forgot-password/route";

const mailEnv = {
  MAIL_PROVIDER: "brevo",
  MAIL_API_KEY: "key-123",
  MAIL_FROM: "noreply@example.com",
  APP_BASE_URL: "https://app.example.com",
};
const keys = [...Object.keys(mailEnv), "NODE_ENV"];
const saved: Record<string, string | undefined> = {};
let ip = 0;

function setEnv(env: Record<string, string>) {
  for (const k of keys) delete (process.env as Record<string, string | undefined>)[k];
  Object.assign(process.env, env);
}

async function ask(email: unknown) {
  const res = await POST(
    new Request("http://localhost/api/auth/forgot-password", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": `10.0.0.${++ip}` },
      body: JSON.stringify({ email }),
    })
  );
  return { status: res.status, body: await res.json() };
}

beforeAll(() => keys.forEach((k) => (saved[k] = process.env[k])));
afterAll(() => keys.forEach((k) => (saved[k] === undefined ? delete (process.env as Record<string, string | undefined>)[k] : (process.env[k] = saved[k]))));
beforeEach(() => {
  jest.clearAllMocks();
  sendMailMock.mockResolvedValue(undefined);
  jest.spyOn(console, "warn").mockImplementation(() => undefined);
  jest.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("production with email set up", () => {
  beforeEach(() => setEnv({ ...mailEnv, NODE_ENV: "production" }));

  it("emails the link to a registered address and never returns it", async () => {
    findUnique.mockResolvedValue({ id: "u1", name: "Pat", email: "pat@example.com" });
    const { status, body } = await ask("Pat@Example.com");

    expect(status).toBe(200);
    expect(body.resetPath).toBeUndefined();
    expect(JSON.stringify(body)).not.toMatch(/token/i);
    expect(createToken).toHaveBeenCalledTimes(1);
    expect(sendMailMock).toHaveBeenCalledTimes(1);
    const [, message] = sendMailMock.mock.calls[0];
    expect(message.to).toBe("pat@example.com");
    expect(message.text).toMatch(/https:\/\/app\.example\.com\/reset-password\?token=[0-9a-f]{64}/);
  });

  it("gives the same answer for an unknown address, and sends nothing", async () => {
    findUnique.mockResolvedValue(null);
    const known = (findUnique.mockResolvedValueOnce({ id: "u1", name: "Pat", email: "pat@example.com" }), await ask("pat@example.com"));
    const unknown = await ask("nobody@example.com");

    expect(unknown.status).toBe(known.status);
    expect(unknown.body).toEqual(known.body);
    expect(createToken).toHaveBeenCalledTimes(1);
    expect(sendMailMock).toHaveBeenCalledTimes(1);
  });

  it("still answers normally when the provider fails", async () => {
    findUnique.mockResolvedValue({ id: "u1", name: "Pat", email: "pat@example.com" });
    sendMailMock.mockRejectedValue(new Error("Mail provider brevo returned HTTP 401"));
    const { status, body } = await ask("pat@example.com");
    expect(status).toBe(200);
    expect(body.resetPath).toBeUndefined();
  });

  it("builds the link from APP_BASE_URL and ignores the Host header", async () => {
    findUnique.mockResolvedValue({ id: "u1", name: "Pat", email: "pat@example.com" });
    const res = await POST(
      new Request("https://evil.example/api/auth/forgot-password", {
        method: "POST",
        headers: { "content-type": "application/json", host: "evil.example", "x-forwarded-host": "evil.example", "x-forwarded-for": `10.1.0.${++ip}` },
        body: JSON.stringify({ email: "pat@example.com" }),
      })
    );
    expect(res.status).toBe(200);
    const [, message] = sendMailMock.mock.calls[0];
    expect(message.text).toContain("https://app.example.com/reset-password?token=");
    expect(message.text).not.toContain("evil.example");
  });
});

describe("production without email set up", () => {
  beforeEach(() => setEnv({ NODE_ENV: "production" }));

  it("creates no token, returns no link, and does not even look the account up", async () => {
    const { status, body } = await ask("pat@example.com");

    expect(status).toBe(200);
    expect(body.resetPath).toBeUndefined();
    expect(body.message).toMatch(/not set up/i);
    expect(findUnique).not.toHaveBeenCalled();
    expect(createToken).not.toHaveBeenCalled();
    expect(sendMailMock).not.toHaveBeenCalled();
  });

  it("is also unavailable when the mail settings are there but APP_BASE_URL is not", async () => {
    setEnv({ ...mailEnv, APP_BASE_URL: "", NODE_ENV: "production" });
    const { body } = await ask("pat@example.com");
    expect(body.resetPath).toBeUndefined();
    expect(createToken).not.toHaveBeenCalled();
  });
});

describe("development", () => {
  beforeEach(() => setEnv({ NODE_ENV: "development" }));

  it("still returns the link so it can be shown on screen", async () => {
    findUnique.mockResolvedValue({ id: "u1", name: "Pat", email: "pat@example.com" });
    const { body } = await ask("pat@example.com");
    expect(body.resetPath).toMatch(/^\/reset-password\?token=[0-9a-f]{64}$/);
    expect(createToken).toHaveBeenCalledTimes(1);
    expect(sendMailMock).not.toHaveBeenCalled();
  });
});

describe("input handling", () => {
  beforeEach(() => setEnv({ NODE_ENV: "production" }));

  it("rejects a missing or non-string email", async () => {
    expect((await ask(undefined)).status).toBe(400);
    expect((await ask(42)).status).toBe(400);
  });
});
