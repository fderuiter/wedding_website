import { NextRequest, NextResponse } from 'next/server';
import { getAppConfig } from '@/lib/config';
import { prisma } from '@/lib/prisma';
import { MultiChannelMessagingProvider } from '@/features/broadcast';
import { loadSessionGuardConfig, resolveActiveAdminPasswordHash } from '@/core/auth/nodeSessionGuards';
import { ADMIN_PASSWORD_RESET_TTL_MS, signAdminPasswordResetToken } from '@/utils/password';
import { AdminPasswordResetRequestSchema } from '@/utils/validation';
import { withApiMiddleware } from '@/utils/withApiMiddleware';
import { ApiError } from '@/utils/ApiError';
import { isHostAllowed } from '@/utils/hostValidation';
import { env } from '@/env';

const RESET_TTL_MINUTES = Math.round(ADMIN_PASSWORD_RESET_TTL_MS / 60000);

const UNIFORM_RESET_RESPONSE = {
  success: true,
  message:
    `If an administrative contact email and email provider are configured, a password reset link valid for ${RESET_TTL_MINUTES} minutes has been sent.`,
};

function isUsableContactEmail(email: string | null | undefined): email is string {
  if (typeof email !== 'string') return false;
  const trimmed = email.trim();
  if (!trimmed || !trimmed.includes('@')) return false;
  const lower = trimmed.toLowerCase();
  if (lower === 'hosts@wedding.example' || lower.endsWith('@wedding.example')) {
    return false;
  }
  return true;
}

function hasActiveEmailProvider(config: {
  emailProvider?: string | null;
  resendApiKey?: string | null;
  sendgridApiKey?: string | null;
  smtpHost?: string | null;
}): boolean {
  const provider = (config.emailProvider || 'smtp').toLowerCase();
  if (provider === 'resend') {
    return Boolean(config.resendApiKey && config.resendApiKey.trim().length > 0);
  }
  if (provider === 'sendgrid') {
    return Boolean(config.sendgridApiKey && config.sendgridApiKey.trim().length > 0);
  }
  if (provider === 'smtp') {
    return Boolean(config.smtpHost && config.smtpHost.trim().length > 0);
  }
  return false;
}

function resolveResetOrigin(req: NextRequest, configuredBaseUrl?: string | null): string {
  if (configuredBaseUrl && configuredBaseUrl.trim().length > 0) {
    try {
      const parsed = new URL(configuredBaseUrl.trim());
      if (!parsed.hostname.toLowerCase().endsWith('wedding.example')) {
        return parsed.origin;
      }
    } catch {
      // Fall back to request origin
    }
  }

  try {
    if (isHostAllowed(req.nextUrl.host)) {
      return req.nextUrl.origin;
    }
  } catch {
    // Ignore host resolution error
  }

  return 'http://localhost:3000';
}

export const POST = withApiMiddleware(async (req: NextRequest) => {
  let body: unknown = {};
  try {
    if (typeof req.text === 'function') {
      const rawText = await req.text();
      body = rawText.trim().length > 0 ? JSON.parse(rawText) : {};
    } else if (typeof req.json === 'function') {
      body = (await req.json()) ?? {};
    }
  } catch {
    throw new ApiError(400, 'Invalid JSON body.');
  }

  const parseResult = AdminPasswordResetRequestSchema.safeParse(body);
  if (!parseResult.success) {
    throw new ApiError(400, parseResult.error.issues[0].message);
  }

  const baseConfig = await getAppConfig('global');
  const liveRow =
    typeof prisma?.appConfig?.findUnique === 'function'
      ? await prisma.appConfig.findUnique({ where: { id: 'global' } })
      : null;
  const config = liveRow ? { ...baseConfig, ...liveRow } : baseConfig;
  const sessionConfig = await loadSessionGuardConfig();

  if (!isUsableContactEmail(config.contactEmail) || !hasActiveEmailProvider(config) || !env.ADMIN_PASSWORD) {
    return NextResponse.json(UNIFORM_RESET_RESPONSE);
  }

  const resetToken = signAdminPasswordResetToken({
    envAdminPassword: env.ADMIN_PASSWORD,
    activePasswordHash: resolveActiveAdminPasswordHash(sessionConfig),
    adminSessionVersion: sessionConfig.adminSessionVersion,
  });

  const origin = resolveResetOrigin(req, config.baseUrl);
  const resetUrl = `${origin}/admin/login?token=${encodeURIComponent(resetToken)}`;

  try {
    const messagingProvider = new MultiChannelMessagingProvider(config);
    const dispatchResult = await messagingProvider.sendEmail({
      to: config.contactEmail.trim(),
      subject: 'Admin Password Reset Request',
      body: [
        'A password reset was requested for your wedding website admin dashboard.',
        `Use the link below within 30 minutes to set a new password:\n${resetUrl}`,
        'If you did not request this change, you can safely ignore this email.',
      ].join('\n\n'),
    });

    if (!dispatchResult.success) {
      console.error('Admin password reset email dispatch failed:', dispatchResult.error);
    }
  } catch (err) {
    console.error('Admin password reset email dispatch threw error:', err);
  }

  return NextResponse.json(UNIFORM_RESET_RESPONSE);
});
