import { BadRequestException } from '@nestjs/common';
import type { z } from 'zod';

/** Parses a request body or query with a contract schema; invalid input becomes a 400 listing each issue. */
export function parseOrThrow<TSchema extends z.ZodType>(
  schema: TSchema,
  value: unknown,
): z.output<TSchema> {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new BadRequestException({
      message: 'Invalid request',
      issues: result.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    });
  }
  return result.data;
}
