import { DocumentType, Prisma } from '@prisma/client';

import { ApiError } from '../middleware/error.js';

type Tx = Prisma.TransactionClient;

function pad(n: number, len: number): string {
  return String(n).padStart(len, '0');
}

/**
 * Atomically allocates the next document number for a document type.
 *
 * Uses a row-level `UPDATE ... RETURNING` inside the caller's transaction, so
 * concurrent allocations serialize on the row lock and can never collide.
 * Document numbers are NEVER computed from MAX(number)+1 — that is racy.
 *
 * Must be called within a transaction client.
 */
export async function nextDocumentNumber(
  tx: Tx,
  documentType: DocumentType,
): Promise<string> {
  const rows = await tx.$queryRaw<
    Array<{ prefix: string; lastNumber: number; padLength: number }>
  >(
    Prisma.sql`
      UPDATE "document_sequences"
      SET "lastNumber" = "lastNumber" + 1,
          "updatedAt" = now()
      WHERE "documentType" = ${documentType}::"DocumentType"
      RETURNING "prefix", "lastNumber", "padLength"
    `,
  );
  if (!rows[0]) {
    throw new ApiError(
      500,
      'INTERNAL_ERROR',
      `Document sequence not configured for ${documentType}`,
    );
  }
  const { prefix, lastNumber, padLength } = rows[0];
  return `${prefix}-${pad(Number(lastNumber), Number(padLength))}`;
}