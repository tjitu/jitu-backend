process.env.FRONTEND_URL ||= "http://localhost:5173";
process.env.BETTER_AUTH_URL ||= "http://localhost:5173";
process.env.BETTER_AUTH_SECRET ||=
  "test-better-auth-secret-at-least-32-characters-long";
process.env.TRUSTED_ORIGINS ||= "http://localhost:5173";
process.env.GOOGLE_CLIENT_ID ||= "test-google-client-id";
process.env.GOOGLE_CLIENT_SECRET ||= "test-google-client-secret";
process.env.DATABASE_URL ||= "postgresql://test:test@localhost:5432/test";
