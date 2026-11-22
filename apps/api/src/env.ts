/**
 * Environment configuration validation for Kraya API.
 * Validates development, staging, and production environments at startup.
 *
 * CRITICAL SECURITY INVARIANT:
 * This module NEVER prints, logs, or returns the VALUES of environment variables.
 * Only variable NAMES and descriptive validation requirements are reported.
 */

export type EnvironmentType = 'development' | 'staging' | 'production';

export interface EnvValidationIssue {
  variable: string;
  reason: string;
}

export interface EnvValidationResult {
  valid: boolean;
  environment: EnvironmentType;
  missingMandatory: string[];
  invalidVariables: EnvValidationIssue[];
  warnings: string[];
  info: string[];
}

export function resolveEnvironmentType(raw?: string): EnvironmentType {
  const norm = (raw || '').trim().toLowerCase();
  if (norm === 'production' || norm === 'prod') return 'production';
  if (norm === 'staging' || norm === 'stage') return 'staging';
  return 'development';
}

function isValidUrl(candidate: string, requireHttps = false): boolean {
  try {
    const parsed = new URL(candidate);
    if (requireHttps) {
      return parsed.protocol === 'https:';
    }
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function isPostgresUrl(candidate: string): boolean {
  return candidate.startsWith('postgres://') || candidate.startsWith('postgresql://');
}

/**
 * Validates the startup environment configuration according to the target environment tier.
 *
 * Tier expectations:
 * - Development: Zero-key out-of-the-box local operation (PGlite + local vault + deterministic extractors).
 * - Staging: Isolated pre-production environment with real PostgreSQL (Neon), strong sessions, and strict auth.
 * - Production: Multi-tenant hardened environment with PostgreSQL, cloud file vault (R2), HTTPS origins, and secret keys.
 */
export function validateStartupEnv(env: Record<string, string | undefined>): EnvValidationResult {
  const environment = resolveEnvironmentType(env.NODE_ENV);
  const missingMandatory: string[] = [];
  const invalidVariables: EnvValidationIssue[] = [];
  const warnings: string[] = [];
  const info: string[] = [];

  // 1. Port validation
  if (env.PORT) {
    const portNum = Number(env.PORT);
    if (!Number.isInteger(portNum) || portNum < 1 || portNum > 65535) {
      invalidVariables.push({
        variable: 'PORT',
        reason: 'Must be an integer between 1 and 65535',
      });
    }
  }

  // 2. Development Tier
  if (environment === 'development') {
    info.push('Target environment: development');

    if (!env.DATABASE_URL) {
      info.push('DATABASE_URL not set — using local PGlite WASM database (./data/kraya-pg).');
    } else if (!isPostgresUrl(env.DATABASE_URL.trim())) {
      warnings.push('DATABASE_URL is set but does not start with postgres:// or postgresql://.');
    }

    if (!env.SESSION_SECRET || env.SESSION_SECRET.trim().length < 16) {
      warnings.push('SESSION_SECRET is unset or under 16 characters. A development fallback will be used.');
    }

    if (!env.R2_ACCOUNT_ID && !env.R2_BUCKET_NAME) {
      info.push('R2 credentials not set — using local disk vault (./data/uploads).');
    }

    if (!env.GEMINI_API_KEY) {
      info.push('GEMINI_API_KEY not set — using deterministic regex extraction fallback for procurement documents.');
    }

    return {
      valid: invalidVariables.length === 0,
      environment,
      missingMandatory,
      invalidVariables,
      warnings,
      info,
    };
  }

  // 3. Staging Tier
  if (environment === 'staging') {
    info.push('Target environment: staging (isolated pre-production verification)');

    // Mandatory: DATABASE_URL must point to PostgreSQL
    if (!env.DATABASE_URL || !env.DATABASE_URL.trim()) {
      missingMandatory.push('DATABASE_URL');
    } else if (!isPostgresUrl(env.DATABASE_URL.trim())) {
      invalidVariables.push({
        variable: 'DATABASE_URL',
        reason: 'Must be a valid postgres:// or postgresql:// connection string',
      });
    }

    // Mandatory: SESSION_SECRET must be at least 32 characters
    if (!env.SESSION_SECRET || !env.SESSION_SECRET.trim()) {
      missingMandatory.push('SESSION_SECRET');
    } else if (env.SESSION_SECRET.trim().length < 32) {
      invalidVariables.push({
        variable: 'SESSION_SECRET',
        reason: 'Must be at least 32 characters long for cryptographically secure session signing',
      });
    }

    // Mandatory: APP_ORIGIN must be specified and valid URL
    if (!env.APP_ORIGIN || !env.APP_ORIGIN.trim()) {
      missingMandatory.push('APP_ORIGIN');
    } else {
      const origins = env.APP_ORIGIN.split(',').map((s) => s.trim()).filter(Boolean);
      for (const origin of origins) {
        if (origin.includes('*')) {
          invalidVariables.push({
            variable: 'APP_ORIGIN',
            reason: 'Wildcard origins (*) are strictly forbidden in staging and production',
          });
        } else if (!isValidUrl(origin)) {
          invalidVariables.push({
            variable: 'APP_ORIGIN',
            reason: `Invalid URL format for origin: ${origin}`,
          });
        }
      }
    }

    // Storage in staging: check if R2 is partially configured
    const r2Keys = [
      Boolean(env.R2_ACCOUNT_ID),
      Boolean(env.R2_ACCESS_KEY_ID),
      Boolean(env.R2_SECRET_ACCESS_KEY),
      Boolean(env.R2_BUCKET_NAME),
    ];
    const r2ConfiguredCount = r2Keys.filter(Boolean).length;
    if (r2ConfiguredCount > 0 && r2ConfiguredCount < 4) {
      invalidVariables.push({
        variable: 'R2_STORAGE_CONFIG',
        reason:
          'Partial R2 configuration: R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, and R2_BUCKET_NAME must all be set together',
      });
    } else if (r2ConfiguredCount === 0) {
      warnings.push(
        'R2 credentials not set for staging — file vault will run in local disk fallback mode (./data/uploads).'
      );
    }

    // Optional service warnings for staging
    if (!env.GEMINI_API_KEY) {
      warnings.push('GEMINI_API_KEY not set — AI document extraction will run in deterministic fallback mode.');
    }
    if (!env.RESEND_API_KEY) {
      warnings.push('RESEND_API_KEY not set — outbound email notifications will be skipped or simulated.');
    }
    if (!env.WHATSAPP_ACCESS_TOKEN) {
      warnings.push('WHATSAPP_ACCESS_TOKEN not set — WhatsApp vendor dispatch will be simulated.');
    }
    if (!env.GSTN_API_KEY) {
      warnings.push('GSTN_API_KEY not set — live GSTN lookup will operate in offline checksum verification mode.');
    }

    return {
      valid: missingMandatory.length === 0 && invalidVariables.length === 0,
      environment,
      missingMandatory,
      invalidVariables,
      warnings,
      info,
    };
  }

  // 4. Production Tier
  info.push('Target environment: production (hardened multi-tenant live operation)');

  // Mandatory Production Variables
  const prodMandatory = [
    'DATABASE_URL',
    'SESSION_SECRET',
    'APP_ORIGIN',
    'R2_ACCOUNT_ID',
    'R2_ACCESS_KEY_ID',
    'R2_SECRET_ACCESS_KEY',
    'R2_BUCKET_NAME',
    'INBOUND_WEBHOOK_SECRET',
    'CRON_SECRET',
  ];

  for (const varName of prodMandatory) {
    if (!env[varName] || !env[varName]!.trim()) {
      missingMandatory.push(varName);
    }
  }

  // Format validation for production
  if (env.DATABASE_URL && !isPostgresUrl(env.DATABASE_URL.trim())) {
    invalidVariables.push({
      variable: 'DATABASE_URL',
      reason: 'Must be a valid postgres:// or postgresql:// connection string',
    });
  }

  if (env.SESSION_SECRET && env.SESSION_SECRET.trim().length < 32) {
    invalidVariables.push({
      variable: 'SESSION_SECRET',
      reason: 'Must be at least 32 characters long in production',
    });
  }

  if (env.INBOUND_WEBHOOK_SECRET && env.INBOUND_WEBHOOK_SECRET.trim().length < 16) {
    invalidVariables.push({
      variable: 'INBOUND_WEBHOOK_SECRET',
      reason: 'Must be at least 16 characters long for webhook HMAC security',
    });
  }

  if (env.CRON_SECRET && env.CRON_SECRET.trim().length < 16) {
    invalidVariables.push({
      variable: 'CRON_SECRET',
      reason: 'Must be at least 16 characters long for internal scheduler security',
    });
  }

  if (env.APP_ORIGIN) {
    const origins = env.APP_ORIGIN.split(',').map((s) => s.trim()).filter(Boolean);
    for (const origin of origins) {
      if (origin.includes('*')) {
        invalidVariables.push({
          variable: 'APP_ORIGIN',
          reason: 'Wildcard origins (*) are strictly forbidden in production',
        });
      } else if (!isValidUrl(origin, true)) {
        invalidVariables.push({
          variable: 'APP_ORIGIN',
          reason: `Production origins must use HTTPS protocol (received: ${origin})`,
        });
      }
    }
  }

  // Warnings for production-grade optional connectors
  if (!env.GEMINI_API_KEY) {
    warnings.push('GEMINI_API_KEY is not set. Multimodal document extraction will use deterministic local engine.');
  }
  if (!env.RESEND_API_KEY) {
    warnings.push('RESEND_API_KEY is not set. Outbound transaction emails cannot be sent.');
  }
  if (!env.GSTN_API_KEY) {
    warnings.push('GSTN_API_KEY is not set. Supplier GSTIN verification will fall back to offline checksums.');
  }

  return {
    valid: missingMandatory.length === 0 && invalidVariables.length === 0,
    environment,
    missingMandatory,
    invalidVariables,
    warnings,
    info,
  };
}

/**
 * Cleanly prints environment validation findings to console without leaking secret values.
 */
export function printEnvValidationReport(result: EnvValidationResult): void {
  for (const inf of result.info) {
    console.log(`[Kraya Config Info] ${inf}`);
  }

  for (const warn of result.warnings) {
    console.warn(`[Kraya Config Warning] ${warn}`);
  }

  if (result.missingMandatory.length > 0) {
    console.error(
      `[Kraya Config Error] Missing mandatory environment variables for ${result.environment}:`
    );
    for (const missing of result.missingMandatory) {
      console.error(`  - ${missing} (REQUIRED)`);
    }
  }

  if (result.invalidVariables.length > 0) {
    console.error(
      `[Kraya Config Error] Invalid environment variable configurations for ${result.environment}:`
    );
    for (const inv of result.invalidVariables) {
      console.error(`  - ${inv.variable}: ${inv.reason}`);
    }
  }
}
