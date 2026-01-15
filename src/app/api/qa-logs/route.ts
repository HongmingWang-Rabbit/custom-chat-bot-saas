/**
 * Q&A Logs API Route
 *
 * GET /api/qa-logs - List Q&A logs for a tenant
 */

import { NextRequest } from 'next/server';
import { z } from 'zod';
import { eq, desc, and, sql } from 'drizzle-orm';
import { getTenantService } from '@/lib/services/tenant-service';
import { qaLogs } from '@/db/schema/tenant';
import { logger } from '@/lib/logger';

// Create a child logger for QA logs API
const log = logger.child({ layer: 'api', service: 'qa-logs' });

// =============================================================================
// Request Validation
// =============================================================================

const listLogsSchema = z.object({
  tenantSlug: z.string().min(1),
  flagged: z.enum(['true', 'false']).optional(),
  reviewed: z.enum(['true', 'false']).optional(),
  limit: z.coerce.number().min(1).max(100).optional().default(50),
  offset: z.coerce.number().min(0).optional().default(0),
});

// =============================================================================
// GET Handler - List Q&A Logs
// =============================================================================

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);

  // Validate query params
  let params;
  try {
    params = listLogsSchema.parse({
      tenantSlug: searchParams.get('tenantSlug'),
      flagged: searchParams.get('flagged'),
      reviewed: searchParams.get('reviewed'),
      limit: searchParams.get('limit'),
      offset: searchParams.get('offset'),
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return Response.json(
        { error: 'Invalid parameters', code: 'INVALID_PARAMS', details: error.errors },
        { status: 400 }
      );
    }
    return Response.json(
      { error: 'Invalid request', code: 'INVALID_REQUEST' },
      { status: 400 }
    );
  }

  const { tenantSlug, flagged, reviewed, limit, offset } = params;

  const tenantService = getTenantService();
  const tenantDb = await tenantService.getTenantDb(tenantSlug);

  if (!tenantDb) {
    return Response.json(
      { error: 'Tenant not found', code: 'TENANT_NOT_FOUND' },
      { status: 404 }
    );
  }

  try {
    // Build conditions
    const conditions = [];
    if (flagged !== undefined) {
      conditions.push(eq(qaLogs.flagged, flagged === 'true'));
    }
    if (reviewed !== undefined) {
      conditions.push(eq(qaLogs.reviewed, reviewed === 'true'));
    }

    // Execute query
    const logs = await tenantDb
      .select()
      .from(qaLogs)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(qaLogs.createdAt))
      .limit(limit)
      .offset(offset);

    // Get total count
    const countResult = await tenantDb
      .select({ count: sql<number>`count(*)` })
      .from(qaLogs)
      .where(conditions.length > 0 ? and(...conditions) : undefined);

    const total = Number(countResult[0]?.count ?? 0);

    return Response.json({
      logs: logs.map((log) => ({
        id: log.id,
        question: log.question,
        answer: log.answer,
        citations: log.citations,
        confidence: log.confidence,
        flagged: log.flagged,
        flaggedAt: log.flaggedAt,
        flaggedReason: log.flaggedReason,
        reviewed: log.reviewed,
        reviewedAt: log.reviewedAt,
        reviewerNotes: log.reviewerNotes,
        sessionId: log.sessionId,
        createdAt: log.createdAt,
      })),
      pagination: {
        total,
        limit,
        offset,
        hasMore: offset + logs.length < total,
      },
    });
  } catch (error) {
    log.error({ event: 'list_error', tenant: tenantSlug, error: error instanceof Error ? error.message : String(error) }, 'Failed to list Q&A logs');
    return Response.json(
      { error: 'Failed to list logs', code: 'LIST_ERROR' },
      { status: 500 }
    );
  }
}
