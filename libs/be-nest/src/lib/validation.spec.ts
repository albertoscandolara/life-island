import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';
import { parseOrThrow } from './validation.js';

describe('parseOrThrow', () => {
  const schema = z.object({
    limit: z.coerce.number().int().max(100),
    tags: z.array(z.string()).default([]),
  });

  it('returns the parsed output, defaults included', () => {
    expect(parseOrThrow(schema, { limit: '10' })).toEqual({
      limit: 10,
      tags: [],
    });
  });

  it('throws a 400 that lists every issue with its path', () => {
    try {
      parseOrThrow(schema, { limit: 500, tags: [1] });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(BadRequestException);
      const body = (error as BadRequestException).getResponse() as {
        issues: { path: string }[];
      };
      expect(body.issues.map((issue) => issue.path)).toEqual([
        'limit',
        'tags.0',
      ]);
    }
  });
});
