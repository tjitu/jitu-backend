import 'dotenv/config';
import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { getPrismaClient } from './prisma-client';
import * as nodemailer from 'nodemailer';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { Logger } from '@nestjs/common';

const logger = new Logger('Auth');

type AuthEnvironment = {
  authBaseURL: string;
  trustedOrigins: string[];
  googleClientId: string;
  googleClientSecret: string;
  secret: string;
};

// --- SETUP NODEMAILER ---
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number.parseInt(process.env.SMTP_PORT || '587'),
  secure: process.env.SMTP_SECURE === 'true',
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

// --- LOAD EMAIL TEMPLATE ---
const getResetPasswordEmailTemplate = (url: string, email: string) => {
  const templatePath = path.join(
    __dirname,
    '..',
    'templates',
    'reset-password.html',
  );

  try {
    let template = fs.readFileSync(templatePath, 'utf-8');
    template = template.replaceAll('{{url}}', url);
    template = template.replaceAll('{{email}}', email);
    template = template.replaceAll('{{year}}', new Date().getFullYear().toString());
    return template;
  } catch {
    // Fallback to simple template if file not found
    logger.warn('Email template not found, using fallback');
    return `
      <h1>Reset Password Jitu Academy</h1>
      <p>Halo ${email},</p>
      <p>Klik link berikut untuk reset password: <a href="${url}">${url}</a></p>
      <p>Link ini akan kadaluarsa dalam 1 jam.</p>
    `;
  }
};

// Validate required environment variables at startup
const validateEnvVars = (): AuthEnvironment => {
  const authBaseURL = process.env.BETTER_AUTH_URL || process.env.FRONTEND_URL;
  if (!authBaseURL) {
    throw new Error(
      'BETTER_AUTH_URL (or FRONTEND_URL) must be set to the public frontend origin that proxies /api/auth',
    );
  }

  let authOrigin: string;
  try {
    const parsedURL = new URL(authBaseURL);
    if (!['http:', 'https:'].includes(parsedURL.protocol)) {
      throw new Error('URL must use HTTP or HTTPS');
    }
    authOrigin = parsedURL.origin;
  } catch (error) {
    throw new Error(`BETTER_AUTH_URL is invalid: ${String(error)}`);
  }

  const trustedOrigins = (process.env.TRUSTED_ORIGINS || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  if (trustedOrigins.length === 0) {
    throw new Error('TRUSTED_ORIGINS must contain at least one allowed origin');
  }

  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error('BETTER_AUTH_SECRET must contain at least 32 characters');
  }

  const googleClientId = process.env.GOOGLE_CLIENT_ID;
  const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!googleClientId || !googleClientSecret) {
    throw new Error(
      'GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set to enable Google OAuth',
    );
  }

  return {
    authBaseURL: authOrigin,
    trustedOrigins: [...new Set([...trustedOrigins, authOrigin])],
    googleClientId,
    googleClientSecret,
    secret,
  };
};

/**
 * Creates the Better Auth instance using the shared PrismaClient singleton.
 * This ensures only one database connection pool exists in the application.
 */
export const createAuth = () => {
  const {
    authBaseURL,
    trustedOrigins,
    googleClientId,
    googleClientSecret,
    secret,
  } = validateEnvVars();

  const prisma = getPrismaClient();

  return betterAuth({
    baseURL: authBaseURL,
    secret,
    trustedOrigins,
    database: prismaAdapter(prisma, {
      provider: 'postgresql',
    }),
    emailAndPassword: {
      enabled: true,
      async sendResetPassword(data) {
        logger.log(`Sending reset email to: ${data.user.email}`);

        try {
          await transporter.sendMail({
            from: process.env.SMTP_FROM,
            to: data.user.email,
            subject: 'Reset Password Jitu Academy',
            html: getResetPasswordEmailTemplate(data.url, data.user.email),
          });
          logger.log('Email sent successfully');
        } catch (error) {
          logger.error('Failed to send email', error);
        }
      },
    },

    socialProviders: {
      google: {
        clientId: googleClientId,
        clientSecret: googleClientSecret,
      },
    },
    user: {
      additionalFields: {
        role: {
          type: 'string',
          required: false,
          defaultValue: 'USER',
          input: false,
        },
        target: {
          type: 'string',
          required: false,
          defaultValue: 'UTBK 2026',
          input: false,
        },
      },
    },

    advanced: {
      cookies: {
        session_token: {
          attributes: {
            sameSite: 'lax',
            secure: process.env.NODE_ENV === 'production',
            httpOnly: true,
          },
        },
      },
    },
  });
};

// Export type for the auth instance
export type Auth = ReturnType<typeof createAuth>;

// Singleton auth instance for use with @thallesp/nestjs-better-auth
// Created lazily on first access to ensure environment variables are loaded
let authInstance: Auth | null = null;

export const getAuth = (): Auth => {
  if (!authInstance) {
    authInstance = createAuth();
  }
  return authInstance;
};

// Default export for backward compatibility with app.module.ts
export const auth = getAuth();
