/**
 * Tenant Provisioning Continue API Route
 *
 * POST /api/tenants/[slug]/continue - Execute next provisioning step
 *
 * This endpoint is called repeatedly by the frontend to progress through
 * provisioning steps. Each call executes ONE step and returns the new state.
 *
 * Provisioning states:
 * - provisioning: Initial state, needs to create Supabase project
 * - project_created: Project created, waiting for it to be ready
 * - project_ready: Project ready, needs to run migrations
 * - migrating: Migrations running
 * - active: Provisioning complete
 * - error: Provisioning failed
 */

import { NextRequest } from 'next/server';
import { getTenantService } from '@/lib/services/tenant-service';
import {
  provisionSupabaseProject,
  ProvisioningOptions,
} from '@/lib/supabase/provisioning';
import { runTenantMigrations } from '@/lib/supabase/tenant-migrations';
import {
  createRequestContext,
  createLayerLogger,
  Timer,
} from '@/lib/logger';

// =============================================================================
// POST Handler - Continue Provisioning
// =============================================================================

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const ctx = createRequestContext({ path: `/api/tenants/${slug}/continue`, method: 'POST' });
  const log = createLayerLogger('admin', ctx);
  const timer = new Timer();

  log.info({ event: 'continue_provisioning', slug }, 'Continue provisioning request');

  const tenantService = getTenantService();

  // Get tenant with any status
  const tenant = await tenantService.getTenantAnyStatus(slug);
  if (!tenant) {
    return Response.json(
      { error: 'Tenant not found', code: 'NOT_FOUND' },
      { status: 404, headers: { 'X-Trace-Id': ctx.traceId } }
    );
  }

  // If already active or deleted, nothing to do
  if (tenant.status === 'active') {
    return Response.json({
      status: 'active',
      message: 'Provisioning complete',
      debug: { traceId: ctx.traceId, total_ms: timer.elapsed() },
    });
  }

  if (tenant.status === 'deleted') {
    return Response.json(
      { error: 'Tenant is deleted', code: 'DELETED' },
      { status: 400, headers: { 'X-Trace-Id': ctx.traceId } }
    );
  }

  // Handle error state - allow retry
  if (tenant.status === 'error') {
    // Reset to provisioning to allow retry
    log.info({ event: 'retry_provisioning', slug }, 'Retrying failed provisioning');
    await tenantService.updateTenantStatusOnly(slug, 'provisioning');
  }

  try {
    // Determine current step and execute next one
    const hasProjectRef = !!tenant.supabaseProjectRef;
    const hasCredentials = !!tenant.encryptedDatabaseUrl;

    // Step 1: Create Supabase project if not created yet
    if (!hasProjectRef) {
      log.info({ event: 'step_create_project', slug }, 'Creating Supabase project...');

      // Get the stored password from provisioning state
      const provisioningState = await tenantService.getProvisioningState(slug);
      if (!provisioningState?.dbPassword) {
        throw new Error('No provisioning state found. Please start provisioning again.');
      }

      const options: ProvisioningOptions = {
        dbPassword: provisioningState.dbPassword,
        onProjectCreated: async (projectRef) => {
          await tenantService.updateProvisioningProjectRef(slug, projectRef);
        },
      };

      // This creates the project and waits for it to be ready
      const credentials = await provisionSupabaseProject(slug, options);

      // Store credentials
      await tenantService.updateProvisioningCredentials(slug, {
        databaseUrl: credentials.databaseUrl,
        serviceKey: credentials.serviceKey,
        anonKey: credentials.anonKey,
        databaseHost: `${credentials.projectRef}.supabase.co`,
      });

      return Response.json({
        status: 'project_ready',
        step: 'project_created',
        message: 'Supabase project created and ready',
        projectRef: credentials.projectRef,
        debug: { traceId: ctx.traceId, total_ms: timer.elapsed() },
      });
    }

    // Step 2: Run migrations if project exists (credentials stored)
    if (hasCredentials) {
      log.info({ event: 'step_migrations', slug }, 'Running migrations...');

      // Get decrypted credentials
      const tenantWithSecrets = await tenantService.getTenantWithSecrets(slug);
      if (!tenantWithSecrets) {
        throw new Error('Failed to get tenant credentials');
      }

      // Run migrations
      const migrationResult = await runTenantMigrations(tenantWithSecrets.databaseUrl);

      if (!migrationResult.success) {
        throw new Error(`Migrations failed: ${migrationResult.errors.join(', ')}`);
      }

      // Complete provisioning
      await tenantService.updateTenantStatusOnly(slug, 'active');

      log.info({ event: 'provisioning_complete', slug }, 'Provisioning complete');

      return Response.json({
        status: 'active',
        step: 'migrations_complete',
        message: 'Provisioning complete',
        migrationsRun: migrationResult.migrationsRun,
        debug: { traceId: ctx.traceId, total_ms: timer.elapsed() },
      });
    }

    // Unexpected state
    return Response.json({
      status: tenant.status,
      message: 'Unknown provisioning state',
      debug: {
        traceId: ctx.traceId,
        hasProjectRef,
        hasCredentials,
        total_ms: timer.elapsed(),
      },
    });

  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    log.error({ event: 'provisioning_step_failed', slug, error: errorMsg }, 'Provisioning step failed');

    // Mark as error
    await tenantService.failProvisioning(slug, errorMsg);

    return Response.json(
      {
        status: 'error',
        error: errorMsg,
        message: 'Provisioning failed. You can retry by calling this endpoint again.',
        debug: { traceId: ctx.traceId, total_ms: timer.elapsed() },
      },
      { status: 500, headers: { 'X-Trace-Id': ctx.traceId } }
    );
  }
}
