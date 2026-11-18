import { internalHeaders } from '@life-island/be-common';
import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  personSummaryName,
  type HomePeopleDto,
  type PersonSummaryDto,
} from '@life-island/contracts';
import { CONFIG, type HomeConfig } from '../config.js';

/**
 * Reads the people from svc-people's HTTP API, to offer them as owners: they
 * belong to the People area, and this service never touches its tables.
 * When svc-people cannot be reached, owners are simply typed.
 */
@Injectable()
export class HomePeople {
  private readonly log = new Logger(HomePeople.name);

  constructor(@Inject(CONFIG) private readonly config: HomeConfig) {}

  async list(): Promise<HomePeopleDto> {
    try {
      const response = await fetch(`${this.config.peopleUrl}/people`, {
        signal: AbortSignal.timeout(3000),
        headers: internalHeaders(),
      });
      if (!response.ok)
        throw new Error(`svc-people answered ${response.status}`);
      const people = (await response.json()) as PersonSummaryDto[];
      return {
        available: true,
        people: people.map((p) => ({
          id: p.id,
          name: personSummaryName(p),
          taxCode: p.taxCode,
          residencePropertyId: p.residencePropertyId,
        })),
      };
    } catch (error) {
      this.log.warn(
        `People not available from ${this.config.peopleUrl}: ${(error as Error).message}`,
      );
      return { available: false, people: [] };
    }
  }
}
