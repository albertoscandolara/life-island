import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import {
  CERTIFICATION_PRESETS,
  CERTIFICATION_STATUS_LABELS,
  CERTIFICATION_STATUSES,
  COURSE_STATUS_LABELS,
  COURSE_STATUSES,
  pathStep,
  STUDY_TOPIC_LABELS,
  STUDY_TOPICS,
  type CertificationDto,
  type CertificationStatus,
  type CourseDto,
  type CourseStatus,
  type StudiesOverviewDto,
  type StudyTopic,
} from '@life-island/contracts';
import {
  UiBadge,
  UiButton,
  UiCard,
  UiEmptyState,
  UiIcon,
  UiProgressBar,
  type UiTone,
} from '@life-island/design-system';
import type { Observable } from 'rxjs';
import { StudiesApi } from '../api/studies-api';
import {
  dateText,
  errorText,
  euro,
  numberOrNull,
  safeUrl,
  textOrNull,
} from './labels';

interface CourseDraft {
  id: string | null;
  title: string;
  platformId: string;
  url: string;
  topic: StudyTopic;
  stepId: string;
  status: CourseStatus;
  progress: number;
  hours: string;
  cost: string;
  startedOn: string;
  completedOn: string;
  certificateUrl: string;
  notes: string;
}

interface CertificationDraft {
  id: string | null;
  name: string;
  provider: string;
  topic: StudyTopic;
  status: CertificationStatus;
  examOn: string;
  cost: string;
  obtainedOn: string;
  expiresOn: string;
  credentialUrl: string;
  notes: string;
}

const COURSE_TONES: Record<CourseStatus, UiTone> = {
  planned: 'neutral',
  in_progress: 'progress',
  completed: 'success',
  dropped: 'neutral',
};

const CERTIFICATION_TONES: Record<CertificationStatus, UiTone> = {
  planned: 'neutral',
  booked: 'info',
  passed: 'success',
  failed: 'danger',
};

/** The courses you take and the exams and certifications you aim for, with what they cost. */
@Component({
  selector: 'studies-courses',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [UiBadge, UiButton, UiCard, UiEmptyState, UiIcon, UiProgressBar],
  templateUrl: './courses-tab.html',
  styleUrls: ['./blocks.css', './courses-tab.css'],
})
export class CoursesTab {
  private readonly api = inject(StudiesApi);

  readonly data = input.required<StudiesOverviewDto>();
  readonly changed = output<void>();
  readonly failed = output<string>();

  protected readonly topics = STUDY_TOPICS;
  protected readonly topicLabels = STUDY_TOPIC_LABELS;
  protected readonly courseStatuses = COURSE_STATUSES;
  protected readonly courseStatusLabels = COURSE_STATUS_LABELS;
  protected readonly courseTones = COURSE_TONES;
  protected readonly certificationStatuses = CERTIFICATION_STATUSES;
  protected readonly certificationStatusLabels = CERTIFICATION_STATUS_LABELS;
  protected readonly certificationTones = CERTIFICATION_TONES;
  protected readonly presets = CERTIFICATION_PRESETS;
  protected readonly paths = computed(() => this.data().catalogue);
  protected readonly dateText = dateText;
  protected readonly euro = euro;
  protected readonly safeUrl = safeUrl;
  protected readonly pathStep = pathStep;

  protected readonly busy = signal<string | null>(null);
  protected readonly course = signal<CourseDraft | null>(null);
  protected readonly certification = signal<CertificationDraft | null>(null);

  /** Courses you are taking or will take, then the ones you finished or dropped. */
  protected readonly groups = computed(() => {
    const courses = this.data().courses;
    return [
      {
        label: '',
        courses: courses.filter(
          (c) => c.status === 'in_progress' || c.status === 'planned',
        ),
      },
      {
        label: 'Completed and dropped',
        courses: courses.filter(
          (c) => c.status === 'completed' || c.status === 'dropped',
        ),
      },
    ].filter((g) => g.courses.length);
  });

  private run(
    key: string,
    call: Observable<unknown>,
    failure: string,
    done?: () => void,
  ): void {
    this.busy.set(key);
    call.subscribe({
      next: () => {
        this.busy.set(null);
        done?.();
        this.changed.emit();
      },
      error: (error: unknown) => {
        this.busy.set(null);
        this.failed.emit(errorText(error, failure));
      },
    });
  }

  // ---- courses
  protected startCourse(c?: CourseDto): void {
    this.course.set({
      id: c?.id ?? null,
      title: c?.title ?? '',
      platformId: c?.platformId ?? '',
      url: c?.url ?? '',
      topic: c?.topic ?? 'ai',
      stepId: c?.stepId ?? '',
      status: c?.status ?? 'planned',
      progress: c?.progress ?? 0,
      hours: c?.hours?.toString() ?? '',
      cost: c?.cost?.toString() ?? '',
      startedOn: c?.startedOn ?? '',
      completedOn: c?.completedOn ?? '',
      certificateUrl: c?.certificateUrl ?? '',
      notes: c?.notes ?? '',
    });
  }

  protected setCourse(patch: Partial<CourseDraft>): void {
    this.course.update((d) => (d ? { ...d, ...patch } : d));
  }

  protected saveCourse(): void {
    const d = this.course();
    if (!d) return;
    const request = {
      title: d.title,
      platformId: d.platformId || null,
      url: textOrNull(d.url),
      topic: d.topic,
      stepId: d.stepId || null,
      status: d.status,
      progress: d.progress,
      hours: numberOrNull(d.hours),
      cost: numberOrNull(d.cost),
      startedOn: d.startedOn || null,
      completedOn: d.completedOn || null,
      certificateUrl: textOrNull(d.certificateUrl),
      notes: textOrNull(d.notes),
    };
    this.run(
      d.id ?? 'course',
      d.id ? this.api.updateCourse(d.id, request) : this.api.addCourse(request),
      'Could not save the course.',
      () => this.course.set(null),
    );
  }

  /** Moves a course on: progress in steps of 10, completed at 100. */
  protected bump(c: CourseDto, by: number): void {
    const progress = Math.max(0, Math.min(100, c.progress + by));
    this.run(
      c.id,
      this.api.updateCourse(c.id, {
        ...courseRequest(c),
        progress,
        status: progress === 100 ? 'completed' : 'in_progress',
      }),
      'Could not update the course.',
    );
  }

  protected removeCourse(c: CourseDto): void {
    this.run(c.id, this.api.removeCourse(c.id), 'Could not remove the course.');
  }

  // ---- certifications
  protected startCertification(
    c?: CertificationDto,
    preset?: (typeof CERTIFICATION_PRESETS)[number],
  ): void {
    this.certification.set({
      id: c?.id ?? null,
      name: c?.name ?? preset?.name ?? '',
      provider: c?.provider ?? preset?.provider ?? '',
      topic: c?.topic ?? preset?.topic ?? 'infrastructure',
      status: c?.status ?? 'planned',
      examOn: c?.examOn ?? '',
      cost: c?.cost?.toString() ?? '',
      obtainedOn: c?.obtainedOn ?? '',
      expiresOn: c?.expiresOn ?? '',
      credentialUrl: c?.credentialUrl ?? '',
      notes: c?.notes ?? '',
    });
  }

  protected setCertification(patch: Partial<CertificationDraft>): void {
    this.certification.update((d) => (d ? { ...d, ...patch } : d));
  }

  /** A passed certification expires after its validity, if the preset knows it. */
  protected obtained(value: string): void {
    const d = this.certification();
    const preset = this.presets.find((p) => p.name === d?.name);
    const patch: Partial<CertificationDraft> = { obtainedOn: value };
    if (value && preset && !d?.expiresOn)
      patch.expiresOn = `${Number(value.slice(0, 4)) + preset.validYears}${value.slice(4)}`;
    this.setCertification(patch);
  }

  protected saveCertification(): void {
    const d = this.certification();
    if (!d) return;
    const request = {
      name: d.name,
      provider: textOrNull(d.provider),
      topic: d.topic,
      status: d.status,
      examOn: d.examOn || null,
      cost: numberOrNull(d.cost),
      obtainedOn: d.obtainedOn || null,
      expiresOn: d.expiresOn || null,
      credentialUrl: textOrNull(d.credentialUrl),
      notes: textOrNull(d.notes),
    };
    this.run(
      d.id ?? 'certification',
      d.id
        ? this.api.updateCertification(d.id, request)
        : this.api.addCertification(request),
      'Could not save the certification.',
      () => this.certification.set(null),
    );
  }

  protected removeCertification(c: CertificationDto): void {
    this.run(
      c.id,
      this.api.removeCertification(c.id),
      'Could not remove the certification.',
    );
  }

  protected hasCertification(name: string): boolean {
    return this.data().certifications.some((c) => c.name === name);
  }
}

function courseRequest(c: CourseDto) {
  return {
    title: c.title,
    platformId: c.platformId,
    url: c.url,
    topic: c.topic,
    stepId: c.stepId,
    status: c.status,
    progress: c.progress,
    hours: c.hours,
    cost: c.cost,
    startedOn: c.startedOn,
    completedOn: c.completedOn,
    certificateUrl: c.certificateUrl,
    notes: c.notes,
  };
}
