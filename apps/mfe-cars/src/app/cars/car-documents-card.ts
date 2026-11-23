import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
} from '@angular/core';
import {
  CAR_ARCHIVE_FOLDER_LABELS,
  CAR_ARCHIVE_RULES,
  CAR_ORIGINALS_ON_BOARD,
  type CarArchiveAction,
  type CarArchiveDto,
  type CarArchiveItemDto,
  type VehicleStatus,
} from '@life-island/contracts';
import {
  UiAlert,
  UiBadge,
  UiButton,
  UiCard,
  UiIcon,
  type UiTone,
} from '@life-island/design-system';
import { dateText } from '@life-island/records-ui';
import { CarsApi } from '../api/cars-api';

const ACTION_TONES: Record<CarArchiveAction, UiTone> = {
  in_car: 'success',
  keep: 'info',
  discard: 'neutral',
};

/**
 * Which documents of a car to keep: what goes in the car (download it to
 * print only what changed), what stays at home and until when, what can go.
 * The summary of all of them downloads as Excel.
 */
@Component({
  selector: 'cars-documents-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [UiAlert, UiBadge, UiButton, UiCard, UiIcon],
  templateUrl: './car-documents-card.html',
  styleUrls: ['./cars-bits.css', './car-documents-card.css'],
})
export class CarDocumentsCard {
  private readonly api = inject(CarsApi);

  readonly vehicleId = input.required<string>();
  readonly status = input.required<VehicleStatus>();
  readonly archive = input.required<CarArchiveDto>();

  protected readonly inCar = computed(() => this.of('in_car'));
  protected readonly keep = computed(() => this.of('keep'));
  protected readonly discard = computed(() => this.of('discard'));
  /** What goes in the car as a file to print (the libretto is the original). */
  protected readonly printable = computed(() =>
    this.inCar().filter((i) => i.printFiles.length),
  );

  /** What stays at home, one group per folder and reason. */
  protected readonly keepGroups = computed(() => {
    const groups = new Map<string, CarArchiveItemDto[]>();
    for (const item of this.keep()) {
      const key = `${item.folder}|${item.rule}`;
      groups.set(key, [...(groups.get(key) ?? []), item]);
    }
    return [...groups.values()].map((items) => ({
      folder: items[0].folder,
      rule: items[0].rule,
      items,
    }));
  });

  protected readonly originals = CAR_ORIGINALS_ON_BOARD;
  protected readonly folderLabels = CAR_ARCHIVE_FOLDER_LABELS;
  protected readonly rules = CAR_ARCHIVE_RULES;
  protected readonly tones = ACTION_TONES;
  protected readonly dateText = dateText;

  protected url(file: 'in-car.zip' | 'documents.xlsx' | 'archive.zip') {
    return this.api.exportUrl(this.vehicleId(), file);
  }

  protected previewUrl(uploadId: string): string {
    return this.api.previewUrl(uploadId);
  }

  /** "Keep until 31 Dec 2028", "Keep while you have the car". */
  protected keepText(item: CarArchiveItemDto): string {
    if (item.action === 'discard')
      return item.keepUntil ? `Could go since ${dateText(item.keepUntil)}` : '';
    if (item.rule === 'insurance_suspended') return 'Keep until reactivated';
    if (item.rule === 'insurance_latest') return 'Keep until renewed';
    return item.keepUntil
      ? `Keep until ${dateText(item.keepUntil)}`
      : 'Keep while you have the car';
  }

  private of(action: CarArchiveAction): CarArchiveItemDto[] {
    return this.archive().items.filter((i) => i.action === action);
  }
}
