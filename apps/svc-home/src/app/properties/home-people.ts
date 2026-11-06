import { Inject, Injectable, Logger } from '@nestjs/common';
import type { HomePeopleDto, PersonSummaryDto } from '@life-island/contracts';
import { CONFIG, type HomeConfig } from '../config.js';

/** "Rossi Mario" as People shows it, or the tax code when no name is known. */
export function personName(person: PersonSummaryDto): string {
  return (
    [person.firstName, person.lastName].filter(Boolean).join(' ') ||
    person.taxCode ||
    'Unnamed person'
  );
}

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
      });
      if (!response.ok)
        throw new Error(`svc-people answered ${response.status}`);
      const people = (await response.json()) as PersonSummaryDto[];
      return {
        available: true,
        people: people.map((p) => ({
          id: p.id,
          name: personName(p),
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
