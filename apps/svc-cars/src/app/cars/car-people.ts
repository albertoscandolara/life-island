import { Inject, Injectable, Logger } from '@nestjs/common';
import type { CarsPeopleDto, PersonSummaryDto } from '@life-island/contracts';
import { CONFIG, type CarsConfig } from '../config.js';

/** "Mario Rossi" as People shows it, or the tax code when no name is known. */
export function personName(person: PersonSummaryDto): string {
  return (
    [person.firstName, person.lastName].filter(Boolean).join(' ') ||
    person.taxCode ||
    'Unnamed person'
  );
}

/**
 * Reads the people from svc-people's HTTP API, to offer them as the holder
 * and owner of a car: they belong to the People area, and this service never
 * touches its tables. When svc-people cannot be reached, names are typed.
 */
@Injectable()
export class CarPeople {
  private readonly log = new Logger(CarPeople.name);

  constructor(@Inject(CONFIG) private readonly config: CarsConfig) {}

  async list(): Promise<CarsPeopleDto> {
    try {
      const response = await fetch(`${this.config.peopleUrl}/people`, {
        signal: AbortSignal.timeout(3000),
      });
      if (!response.ok)
        throw new Error(`svc-people answered ${response.status}`);
      const people = (await response.json()) as PersonSummaryDto[];
      return {
        available: true,
        people: people
          .map((p) => ({
            id: p.id,
            name: personName(p),
            taxCode: p.taxCode,
            licence: p.drivingLicence ?? null,
          }))
          .sort((a, b) => a.name.localeCompare(b.name)),
      };
    } catch (error) {
      this.log.warn(
        `People not available from ${this.config.peopleUrl}: ${(error as Error).message}`,
      );
      return { available: false, people: [] };
    }
  }
}
