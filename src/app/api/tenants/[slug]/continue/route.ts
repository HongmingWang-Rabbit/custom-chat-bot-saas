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
  createProjectOnly,
  checkProjectReady,
  completeProjectSetup,
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

    // Get the stored password from provisioning state (needed for all steps)
    const provisioningState = await tenantService.getProvisioningState(slug);
    if (!provisioningState?.dbPassword) {
      throw new Error('No provisioning state found. Please start provisioning again.');
    }

    // Step 1: Create Supabase project if not created yet
    if (!hasProjectRef) {
      log.info({ event: 'step_create_project', slug }, 'Creating Supabase project...');

      // Create project only (fast, ~5-10s) - doesn't wait for it to be ready
      const { projectRef, status } = await createProjectOnly(
        slug,
        provisioningState.dbPassword
      );

      // Save project ref immediately
      await tenantService.updateProvisioningProjectRef(slug, projectRef);

      log.info({ event: 'project_created', slug, projectRef, status }, 'Project created, initializing...');

      return Response.json({
        status: 'project_creating',
        step: 'project_created',
        message: 'Supabase project created, waiting for initialization...',
        projectRef,
        projectStatus: status,
        debug: { traceId: ctx.traceId, total_ms: timer.elapsed() },
      });
    }

    // Step 2: Check if project is ready and complete setup
    if (hasProjectRef && !hasCredentials) {
      log.info({ event: 'step_check_ready', slug, projectRef: tenant.supabaseProjectRef }, 'Checking if project is ready...');

      // Check if project is ready (fast, ~1-2s)
      const { ready, status } = await checkProjectReady(tenant.supabaseProjectRef!);

      if (!ready) {
        log.info({ event: 'project_not_ready', slug, status }, 'Project still initializing...');
        return Response.json({
          status: 'project_creating',
          step: 'waiting_for_ready',
          message: `Project initializing (status: ${status})...`,
          projectRef: tenant.supabaseProjectRef,
          projectStatus: status,
          debug: { traceId: ctx.traceId, total_ms: timer.elapsed() },
        });
      }

      // Project is ready - complete setup (get keys, create bucket, ~5-10s)
      log.info({ event: 'step_complete_setup', slug }, 'Project ready, completing setup...');
      const credentials = await completeProjectSetup(
        tenant.supabaseProjectRef!,
        provisioningState.dbPassword
      );

      // Store credentials
      await tenantService.updateProvisioningCredentials(slug, {
        databaseUrl: credentials.databaseUrl,
        serviceKey: credentials.serviceKey,
        anonKey: credentials.anonKey,
        databaseHost: `${credentials.projectRef}.supabase.co`,
      });

      log.info({ event: 'setup_complete', slug }, 'Project setup complete, ready for migrations');

      return Response.json({
        status: 'project_ready',
        step: 'setup_complete',
        message: 'Supabase project ready, credentials stored',
        projectRef: credentials.projectRef,
        debug: { traceId: ctx.traceId, total_ms: timer.elapsed() },
      });
    }

    // Step 3: Run migrations if credentials exist
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
