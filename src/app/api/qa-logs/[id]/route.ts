/**
 * Q&A Log Detail API Route
 *
 * GET /api/qa-logs/[id] - Get a specific log
 * PATCH /api/qa-logs/[id] - Flag or review a log
 */

import { NextRequest } from 'next/server';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { getTenantService } from '@/lib/services/tenant-service';
import { qaLogs } from '@/db/schema/tenant';

// =============================================================================
// Request Validation
// =============================================================================

const updateLogSchema = z.object({
  tenantSlug: z.string().min(1),
  flagged: z.boolean().optional(),
  flaggedReason: z.string().max(500).optional(),
  reviewed: z.boolean().optional(),
  reviewerNotes: z.string().optional(),
});

type UpdateLogRequest = z.infer<typeof updateLogSchema>;

// =============================================================================
// GET Handler - Get Log Details
// =============================================================================

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const { searchParams } = new URL(request.url);
  const tenantSlug = searchParams.get('tenantSlug');

  if (!tenantSlug) {
    return Response.json(
      { error: 'tenantSlug is required', code: 'MISSING_TENANT' },
      { status: 400 }
    );
  }

  const tenantService = getTenantService();
  const tenantDb = await tenantService.getTenantDb(tenantSlug);

  if (!tenantDb) {
    return Response.json(
      { error: 'Tenant not found', code: 'TENANT_NOT_FOUND' },
      { status: 404 }
    );
  }

  try {
    const [log] = await tenantDb
      .select()
      .from(qaLogs)
      .where(eq(qaLogs.id, id))
      .limit(1);

    if (!log) {
      return Response.json(
        { error: 'Log not found', code: 'NOT_FOUND' },
        { status: 404 }
      );
    }

    return Response.json({
      log: {
        id: log.id,
        question: log.question,
        answer: log.answer,
        citations: log.citations,
        confidence: log.confidence,
        retrievalScores: log.retrievalScores,
        flagged: log.flagged,
        flaggedAt: log.flaggedAt,
        flaggedReason: log.flaggedReason,
        reviewed: log.reviewed,
        reviewedAt: log.reviewedAt,
        reviewerNotes: log.reviewerNotes,
        debugInfo: log.debugInfo,
        userAgent: log.userAgent,
        sessionId: log.sessionId,
        createdAt: log.createdAt,
      },
    });
  } catch (error) {
    console.error('[QA Log API] Get error:', error);
    return Response.json(
      { error: 'Failed to get log', code: 'GET_ERROR' },
      { status: 500 }
    );
  }
}

// =============================================================================
// PATCH Handler - Flag or Review Log
// =============================================================================

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  // Parse request body
  let body: UpdateLogRequest;
  try {
    const json = await request.json();
    body = updateLogSchema.parse(json);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return Response.json(
        { error: 'Validation failed', code: 'VALIDATION_ERROR', details: error.errors },
        { status: 400 }
      );
    }
    return Response.json(
      { error: 'Invalid request body', code: 'INVALID_REQUEST' },
      { status: 400 }
    );
  }

  const { tenantSlug, flagged, flaggedReason, reviewed, reviewerNotes } = body;

  const tenantService = getTenantService();
  const tenantDb = await tenantService.getTenantDb(tenantSlug);

  if (!tenantDb) {
    return Response.json(
      { error: 'Tenant not found', code: 'TENANT_NOT_FOUND' },
      { status: 404 }
    );
  }

  try {
    // Check log exists
    const [existing] = await tenantDb
      .select({ id: qaLogs.id })
      .from(qaLogs)
      .where(eq(qaLogs.id, id))
      .limit(1);

    if (!existing) {
      return Response.json(
        { error: 'Log not found', code: 'NOT_FOUND' },
        { status: 404 }
      );
    }

    // Build update data
    const updateData: Record<string, unknown> = {};

    if (flagged !== undefined) {
      updateData.flagged = flagged;
      updateData.flaggedAt = flagged ? new Date() : null;
      if (flaggedReason !== undefined) {
        updateData.flaggedReason = flaggedReason;
      }
    }

    if (reviewed !== undefined) {
      updateData.reviewed = reviewed;
      updateData.reviewedAt = reviewed ? new Date() : null;
      if (reviewerNotes !== undefined) {
        updateData.reviewerNotes = reviewerNotes;
      }
    }

    // Update log
    const [updated] = await tenantDb
      .update(qaLogs)
      .set(updateData)
      .where(eq(qaLogs.id, id))
      .returning();

    return Response.json({
      log: {
        id: updated.id,
        flagged: updated.flagged,
        flaggedAt: updated.flaggedAt,
        flaggedReason: updated.flaggedReason,
        reviewed: updated.reviewed,
        reviewedAt: updated.reviewedAt,
        reviewerNotes: updated.reviewerNotes,
      },
    });
  } catch (error) {
    console.error('[QA Log API] Update error:', error);
    return Response.json(
      { error: 'Failed to update log', code: 'UPDATE_ERROR' },
      { status: 500 }
    );
  }
}
