// Runs before any test module is required (jest "setupFiles"), so
// process.env is populated before lib/auth.ts's module-load-time
// `if (!JWT_SECRET) throw` check runs.
process.env.JWT_SECRET = "test-only-jwt-secret-do-not-use-in-production";
process.env.CHECKPOINT_PUBLIC_KEY = "dGVzdC1vbmx5LXB1YmxpYy1rZXk=";
