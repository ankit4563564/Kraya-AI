import { describe, expect, it } from 'vitest';
import { resolveEnvironmentType, validateStartupEnv } from '../src/env.js';

describe('Environment Validator & Startup Guard', () => {
  it('resolves environment types correctly', () => {
    expect(resolveEnvironmentType('production')).toBe('production');
    expect(resolveEnvironmentType('PROD')).toBe('production');
    expect(resolveEnvironmentType('staging')).toBe('staging');
    expect(resolveEnvironmentType('stage')).toBe('staging');
    expect(resolveEnvironmentType('development')).toBe('development');
    expect(resolveEnvironmentType('')).toBe('development');
    expect(resolveEnvironmentType(undefined)).toBe('development');
  });

  describe('Development Tier', () => {
    it('passes cleanly with zero external credentials for out-of-the-box local dev', () => {
      const res = validateStartupEnv({});
      expect(res.valid).toBe(true);
      expect(res.environment).toBe('development');
      expect(res.missingMandatory).toHaveLength(0);
      expect(res.info.some((i) => i.includes('PGlite WASM'))).toBe(true);
      expect(res.info.some((i) => i.includes('local disk vault'))).toBe(true);
      expect(res.info.some((i) => i.includes('deterministic regex extraction'))).toBe(true);
    });

    it('flags invalid port numbers', () => {
      const res = validateStartupEnv({ PORT: '999999' });
      expect(res.valid).toBe(false);
      expect(res.invalidVariables[0].variable).toBe('PORT');
    });
  });

  describe('Staging Tier', () => {
    it('fails when mandatory staging variables are missing', () => {
      const res = validateStartupEnv({ NODE_ENV: 'staging' });
      expect(res.valid).toBe(false);
      expect(res.missingMandatory).toContain('DATABASE_URL');
      expect(res.missingMandatory).toContain('SESSION_SECRET');
      expect(res.missingMandatory).toContain('APP_ORIGIN');
    });

    it('rejects short session secrets in staging', () => {
      const res = validateStartupEnv({
        NODE_ENV: 'staging',
        DATABASE_URL: 'postgres://user:pass@ep-staging.aws.neon.tech/neondb',
        SESSION_SECRET: 'short-secret',
        APP_ORIGIN: 'https://staging.kraya.ai',
      });
      expect(res.valid).toBe(false);
      expect(res.invalidVariables.some((v) => v.variable === 'SESSION_SECRET')).toBe(true);
    });

    it('rejects non-postgres database URLs in staging', () => {
      const res = validateStartupEnv({
        NODE_ENV: 'staging',
        DATABASE_URL: 'mysql://localhost:3306/db',
        SESSION_SECRET: 'this-is-a-very-strong-session-secret-exceeding-32-chars',
        APP_ORIGIN: 'https://staging.kraya.ai',
      });
      expect(res.valid).toBe(false);
      expect(res.invalidVariables.some((v) => v.variable === 'DATABASE_URL')).toBe(true);
    });

    it('rejects wildcard APP_ORIGIN in staging', () => {
      const res = validateStartupEnv({
        NODE_ENV: 'staging',
        DATABASE_URL: 'postgres://user:pass@ep-staging.aws.neon.tech/neondb',
        SESSION_SECRET: 'this-is-a-very-strong-session-secret-exceeding-32-chars',
        APP_ORIGIN: '*',
      });
      expect(res.valid).toBe(false);
      expect(res.invalidVariables.some((v) => v.variable === 'APP_ORIGIN')).toBe(true);
    });

    it('rejects partial R2 credentials configuration in staging', () => {
      const res = validateStartupEnv({
        NODE_ENV: 'staging',
        DATABASE_URL: 'postgres://user:pass@ep-staging.aws.neon.tech/neondb',
        SESSION_SECRET: 'this-is-a-very-strong-session-secret-exceeding-32-chars',
        APP_ORIGIN: 'https://staging.kraya.ai',
        R2_ACCOUNT_ID: 'acc-12345',
        // Missing R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME
      });
      expect(res.valid).toBe(false);
      expect(res.invalidVariables.some((v) => v.variable === 'R2_STORAGE_CONFIG')).toBe(true);
    });

    it('passes staging validation when all mandatory staging variables are provided', () => {
      const res = validateStartupEnv({
        NODE_ENV: 'staging',
        PORT: '8787',
        DATABASE_URL: 'postgresql://kraya_staging:staging_pass@ep-staging-123.ap-southeast-1.aws.neon.tech/neondb?sslmode=require',
        SESSION_SECRET: '9e7a8f1b3c5d7e9a1b3c5d7e9a1b3c5d7e9a1b3c5d7e9a1b3c5d7e9a1b3c5d7e',
        APP_ORIGIN: 'https://staging.kraya.ai,http://localhost:5173',
      });
      expect(res.valid).toBe(true);
      expect(res.environment).toBe('staging');
      expect(res.missingMandatory).toHaveLength(0);
      expect(res.invalidVariables).toHaveLength(0);
      expect(res.warnings.some((w) => w.includes('local disk fallback mode'))).toBe(true);
    });
  });

  describe('Production Tier', () => {
    it('enforces all mandatory production variables including R2, secrets, and HTTPS origin', () => {
      const incomplete = validateStartupEnv({ NODE_ENV: 'production' });
      expect(incomplete.valid).toBe(false);
      expect(incomplete.missingMandatory).toEqual(
        expect.arrayContaining([
          'DATABASE_URL',
          'SESSION_SECRET',
          'APP_ORIGIN',
          'R2_ACCOUNT_ID',
          'R2_ACCESS_KEY_ID',
          'R2_SECRET_ACCESS_KEY',
          'R2_BUCKET_NAME',
          'INBOUND_WEBHOOK_SECRET',
          'CRON_SECRET',
        ])
      );
    });

    it('rejects HTTP (non-HTTPS) origins in production', () => {
      const res = validateStartupEnv({
        NODE_ENV: 'production',
        PORT: '8787',
        DATABASE_URL: 'postgres://user:pass@ep-prod.neon.tech/neondb',
        SESSION_SECRET: 'a-super-secure-production-session-secret-key-32-bytes',
        APP_ORIGIN: 'http://app.kraya.ai', // HTTP disallowed in production
        R2_ACCOUNT_ID: 'cf-account-id',
        R2_ACCESS_KEY_ID: 'cf-access-key',
        R2_SECRET_ACCESS_KEY: 'cf-secret-access-key',
        R2_BUCKET_NAME: 'kraya-vault-prod',
        INBOUND_WEBHOOK_SECRET: 'webhook-secret-at-least-16-chars',
        CRON_SECRET: 'cron-secret-at-least-16-chars',
      });
      expect(res.valid).toBe(false);
      expect(res.invalidVariables.some((v) => v.variable === 'APP_ORIGIN')).toBe(true);
    });

    it('passes production validation when fully configured with HTTPS and cloud storage', () => {
      const res = validateStartupEnv({
        NODE_ENV: 'production',
        PORT: '8787',
        DATABASE_URL: 'postgres://user:pass@ep-prod.neon.tech/neondb?sslmode=require',
        SESSION_SECRET: 'a-super-secure-production-session-secret-key-32-bytes',
        APP_ORIGIN: 'https://app.kraya.ai,https://admin.kraya.ai',
        R2_ACCOUNT_ID: 'cf-account-id',
        R2_ACCESS_KEY_ID: 'cf-access-key',
        R2_SECRET_ACCESS_KEY: 'cf-secret-access-key',
        R2_BUCKET_NAME: 'kraya-vault-prod',
        INBOUND_WEBHOOK_SECRET: 'webhook-secret-at-least-16-chars',
        CRON_SECRET: 'cron-secret-at-least-16-chars',
      });
      expect(res.valid).toBe(true);
      expect(res.environment).toBe('production');
      expect(res.missingMandatory).toHaveLength(0);
      expect(res.invalidVariables).toHaveLength(0);
    });
  });

  describe('Zero Secret Leakage Invariant', () => {
    it('never prints or exposes secret values in error reasons or warnings', () => {
      const testSecret = 'SUPER_SENSITIVE_SECRET_VALUE_999';
      const res = validateStartupEnv({
        NODE_ENV: 'staging',
        DATABASE_URL: `postgres://admin:${testSecret}@neon.tech/db`,
        SESSION_SECRET: 'short',
        APP_ORIGIN: 'invalid-origin',
        INBOUND_WEBHOOK_SECRET: testSecret,
      });

      const serialized = JSON.stringify(res);
      expect(serialized).not.toContain(testSecret);
    });
  });
});
