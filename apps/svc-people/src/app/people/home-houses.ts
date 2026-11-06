import { Inject, Injectable, Logger } from '@nestjs/common';
import type { PropertyDto, ResidenceHousesDto } from '@life-island/contracts';
import { CONFIG, type PeopleConfig } from '../config.js';

/** Address and city as one line, the way Residence shows a house. */
export function houseAddress(
  house: Pick<PropertyDto, 'address' | 'city'>,
): string | null {
  return [house.address, house.city].filter(Boolean).join(', ') || null;
}

/**
 * Reads the houses from svc-home's HTTP API: they belong to the Home area,
 * and this service never touches its tables. When svc-home cannot be reached,
 * Residence is simply typed.
 */
@Injectable()
export class HomeHouses {
  private readonly log = new Logger(HomeHouses.name);

  constructor(@Inject(CONFIG) private readonly config: PeopleConfig) {}

  async list(): Promise<ResidenceHousesDto> {
    try {
      const response = await fetch(`${this.config.homeUrl}/properties`, {
        signal: AbortSignal.timeout(3000),
      });
      if (!response.ok) throw new Error(`svc-home answered ${response.status}`);
      const properties = (await response.json()) as PropertyDto[];
      return {
        available: true,
        houses: properties
          .map((p) => ({ id: p.id, name: p.name, address: houseAddress(p) }))
          .sort((a, b) => a.name.localeCompare(b.name)),
      };
    } catch (error) {
      this.log.warn(
        `Houses not available from ${this.config.homeUrl}: ${(error as Error).message}`,
      );
      return { available: false, houses: [] };
    }
  }
}
