import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { readNumberSettings, type ServiceDb } from '@life-island/be-common';
import {
  freeId,
  LEARNING_PATHS,
  learningPath,
  pathSlug,
  pathOfStep,
  pathStep,
  type LearningPath,
  STUDY_IDLE_DAYS_SETTING,
  STUDY_WEEKLY_GOAL_SETTING,
  studyReminderSettingKey,
  type CertificationDto,
  type CertificationRequest,
  type CourseDto,
  type CourseRequest,
  type PathBuilderRequest,
  type PathCreateRequest,
  type PathOutlineRequest,
  type PathProgressRequest,
  type StepProgressRequest,
  type StudiesAttentionDto,
  type StudiesOverviewDto,
  type StudyPlanDto,
  type StudyPlanRequest,
  type StudyReminderDays,
  type StudySessionDto,
  type StudySessionRequest,
  type StudyTopic,
  type TrainingPlatformDto,
  type TrainingPlatformRequest,
  deadlineWindow,
  inDeadlineWindow,
  type DeadlineDto,
  type DeadlinesQuery,
} from '@life-island/contracts';
import { and, desc, eq, gte, inArray, sql } from 'drizzle-orm';
import { SERVICE_DB } from '../config.js';
import {
  certifications,
  courses,
  learningPaths,
  outlineChanges,
  pathProgress,
  scoutResources,
  scoutSteps,
  stepProgress,
  studyPlans,
  studySessions,
  trainingPlatforms,
  type CertificationRow,
  type CourseRow,
  type StudyPlanRow,
  type StudySessionRow,
  type TrainingPlatformRow,
} from '../db/schema.js';
import {
  addDays,
  pathsProgress,
  studyReminders,
  studyStats,
  subscriptionSpend,
  yearlyCost,
} from './progress.js';
import { pathLink, studyAttentionItems } from './attention.js';
import { outlinePath, pathTemplates } from './paths.js';
import { PathBuilder } from './path-builder.js';
import { ResourceScout } from './resource-scout.js';
import { StudyCoach } from './study-coach.js';

/** Today in the time zone the app runs in (SETTINGS_TIMEZONE, else Rome). */
export function localToday(
  timeZone = process.env['SETTINGS_TIMEZONE'] || 'Europe/Rome',
  now = new Date(),
): string {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(now);
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

const iso = (date: Date | null) => (date ? date.toISOString() : null);

@Injectable()
export class StudiesService {
  constructor(
    @Inject(SERVICE_DB) private readonly svc: ServiceDb,
    @Inject(StudyCoach) private readonly coach: StudyCoach,
    @Inject(ResourceScout) private readonly scout: ResourceScout,
    @Inject(PathBuilder) private readonly builder: PathBuilder,
  ) {}

  private get db() {
    return this.svc.db;
  }

  /** The weekly goal and the reminder windows, from the settings replica. */
  async settings(): Promise<{ goal: number; days: StudyReminderDays }> {
    const values = await readNumberSettings(this.svc.pool, this.svc.schema, {
      goal: STUDY_WEEKLY_GOAL_SETTING,
      idle: STUDY_IDLE_DAYS_SETTING,
      subscription: studyReminderSettingKey('subscription'),
      exam: studyReminderSettingKey('exam'),
      certification: studyReminderSettingKey('certification'),
    });
    return {
      goal: values.goal,
      days: {
        idle: values.idle,
        subscription: values.subscription,
        exam: values.exam,
        certification: values.certification,
      },
    };
  }

  // ---- overview ------------------------------------------------------------

  async overview(today = localToday()): Promise<StudiesOverviewDto> {
    const since = addDays(today, -90);
    const [
      platformRows,
      courseRows,
      certificationRows,
      sessionRows,
      pathRows,
      stepRows,
      planRows,
      totals,
      settings,
      aiCoach,
      catalogue,
      aiPathBuilder,
    ] = await Promise.all([
      this.db.select().from(trainingPlatforms).orderBy(trainingPlatforms.name),
      this.db.select().from(courses).orderBy(desc(courses.updatedAt)),
      this.db.select().from(certifications).orderBy(certifications.examOn),
      this.db
        .select()
        .from(studySessions)
        .where(gte(studySessions.date, since))
        .orderBy(desc(studySessions.date), desc(studySessions.createdAt)),
      this.db.select().from(pathProgress),
      this.db.select().from(stepProgress),
      this.db
        .select()
        .from(studyPlans)
        .orderBy(desc(studyPlans.createdAt))
        .limit(5),
      this.db
        .select({
          pathId: studySessions.pathId,
          stepId: studySessions.stepId,
          courseId: studySessions.courseId,
          minutes: sql<number>`sum(${studySessions.minutes})::int`,
          last: sql<string>`max(${studySessions.date})::text`,
        })
        .from(studySessions)
        .groupBy(
          studySessions.pathId,
          studySessions.stepId,
          studySessions.courseId,
        ),
      this.settings(),
      this.coach.usesAi(),
      this.scout.catalogue(),
      this.builder.usesAi(),
    ]);

    const platformName = new Map(platformRows.map((p) => [p.id, p.name]));
    const courseCount = new Map<string, number>();
    for (const c of courseRows)
      if (c.platformId)
        courseCount.set(c.platformId, (courseCount.get(c.platformId) ?? 0) + 1);
    const courseMinutes = new Map<string, number>();
    for (const t of totals)
      if (t.courseId)
        courseMinutes.set(
          t.courseId,
          (courseMinutes.get(t.courseId) ?? 0) + t.minutes,
        );

    const platforms = platformRows.map((p) =>
      platformDto(p, courseCount.get(p.id) ?? 0),
    );
    const courseDtos = courseRows.map((c) =>
      courseDto(c, platformName, courseMinutes.get(c.id) ?? 0),
    );
    const certificationDtos = certificationRows.map(certificationDto);
    const sessions = sessionRows.map(sessionDto);
    const paths = pathsProgress(
      pathRows,
      stepRows,
      sessions,
      totals,
      settings.goal,
      today,
      catalogue,
    );
    const stats = studyStats({
      sessions,
      courses: courseDtos,
      certifications: certificationDtos,
      platforms,
      paths,
      weeklyGoalHours: settings.goal,
      totalMinutes: totals.reduce((sum, t) => sum + t.minutes, 0),
      lastSessionOn:
        totals
          .map((t) => t.last)
          .sort()
          .at(-1) ?? null,
      subscriptionSpendThisYear: subscriptionSpend(platforms, today),
      today,
    });
    const reminders = studyReminders({
      platforms,
      certifications: certificationDtos,
      paths,
      daysSinceLastSession: stats.daysSinceLastSession,
      studying:
        paths.some((p) => p.status === 'following') ||
        courseDtos.some((c) => c.status === 'in_progress'),
      days: settings.days,
      today,
      catalogue,
    });
    return {
      platforms,
      courses: courseDtos,
      certifications: certificationDtos,
      sessions,
      paths,
      stats,
      reminders,
      plans: planRows.map(planDto),
      aiCoach,
      aiPathBuilder,
      reminderDays: settings.days,
      catalogue,
      templates: pathTemplates(catalogue),
      scout: await this.scout.status(catalogue, today),
    };
  }

  /** The island's badge: renewals and exams within their window, and what is past. */
  /** Subscription renewals, exams, certification expiries and path targets, for the Agenda (`GET /deadlines`). */
  async deadlines(
    query: DeadlinesQuery,
    today = localToday(),
  ): Promise<DeadlineDto[]> {
    const window = deadlineWindow(query, today);
    const [platformRows, certificationRows, pathRows, catalogue] =
      await Promise.all([
        this.db.select().from(trainingPlatforms),
        this.db.select().from(certifications),
        this.db.select().from(pathProgress),
        this.scout.catalogue(),
      ]);
    const found: DeadlineDto[] = [];
    const add = (d: Omit<DeadlineDto, 'module'>) =>
      found.push({ ...d, module: 'studies' });
    for (const p of platformRows)
      if (
        p.status === 'active' &&
        p.plan !== 'free' &&
        inDeadlineWindow(p.renewsOn, window)
      )
        add({
          id: `platform:${p.id}:${p.renewsOn}`,
          kind: 'subscription',
          title: `${p.name} subscription renews`,
          detail: 'Cancel before it renews if you no longer use it.',
          date: p.renewsOn,
          amount: p.price,
          path: '/studies?tab=courses#studies-platforms',
        });
    for (const c of certificationRows) {
      if (
        (c.status === 'planned' || c.status === 'booked') &&
        inDeadlineWindow(c.examOn, window)
      )
        add({
          id: `exam:${c.id}:${c.examOn}`,
          kind: 'exam',
          title: `Exam: ${c.name}`,
          detail: c.status === 'planned' ? 'Not booked yet.' : null,
          date: c.examOn,
          amount: c.cost,
          path: '/studies?tab=courses',
        });
      if (c.status === 'passed' && inDeadlineWindow(c.expiresOn, window))
        add({
          id: `certification:${c.id}:${c.expiresOn}`,
          kind: 'certification',
          title: `${c.name} expires`,
          detail: 'Renew it or plan the new exam.',
          date: c.expiresOn,
          amount: null,
          path: '/studies?tab=courses',
        });
    }
    for (const p of pathRows)
      if (p.status === 'following' && inDeadlineWindow(p.targetOn, window))
        add({
          id: `path:${p.pathId}:${p.targetOn}`,
          kind: 'path-target',
          title: `Target date: ${learningPath(p.pathId, catalogue)?.name ?? p.pathId}`,
          detail: null,
          date: p.targetOn,
          amount: null,
          path: pathLink(p.pathId),
        });
    return found;
  }

  async attention(today = localToday()): Promise<StudiesAttentionDto> {
    const overview = await this.overview(today);
    const dated = overview.reminders.filter(
      (r) => r.kind !== 'idle' && r.kind !== 'target',
    );
    const items = studyAttentionItems(overview);
    return {
      expired: dated.filter((r) => (r.daysLeft ?? 0) < 0).length,
      expiring: dated.filter((r) => (r.daysLeft ?? 0) >= 0).length,
      toReview: items.length,
      items,
    };
  }

  // ---- platforms -----------------------------------------------------------

  async addPlatform(request: TrainingPlatformRequest): Promise<{ id: string }> {
    const [row] = await this.db
      .insert(trainingPlatforms)
      .values(platformValues(request))
      .returning({ id: trainingPlatforms.id });
    return row;
  }

  async updatePlatform(
    id: string,
    request: TrainingPlatformRequest,
  ): Promise<void> {
    const updated = await this.db
      .update(trainingPlatforms)
      .set(platformValues(request))
      .where(eq(trainingPlatforms.id, id))
      .returning({ id: trainingPlatforms.id });
    if (!updated.length) throw new NotFoundException('Platform not found');
  }

  /** Remembers when you last opened a platform from Studies. */
  async platformOpened(id: string): Promise<void> {
    const updated = await this.db
      .update(trainingPlatforms)
      .set({ lastOpenedAt: new Date() })
      .where(eq(trainingPlatforms.id, id))
      .returning({ id: trainingPlatforms.id });
    if (!updated.length) throw new NotFoundException('Platform not found');
  }

  async removePlatform(id: string): Promise<void> {
    const deleted = await this.db
      .delete(trainingPlatforms)
      .where(eq(trainingPlatforms.id, id))
      .returning({ id: trainingPlatforms.id });
    if (!deleted.length) throw new NotFoundException('Platform not found');
  }

  // ---- courses -------------------------------------------------------------

  async addCourse(
    request: CourseRequest,
    today = localToday(),
  ): Promise<{ id: string }> {
    const [row] = await this.db
      .insert(courses)
      .values(await this.courseValues(request, today))
      .returning({ id: courses.id });
    return row;
  }

  async updateCourse(
    id: string,
    request: CourseRequest,
    today = localToday(),
  ): Promise<void> {
    const updated = await this.db
      .update(courses)
      .set({
        ...(await this.courseValues(request, today)),
        updatedAt: new Date(),
      })
      .where(eq(courses.id, id))
      .returning({ id: courses.id });
    if (!updated.length) throw new NotFoundException('Course not found');
  }

  async removeCourse(id: string): Promise<void> {
    const deleted = await this.db
      .delete(courses)
      .where(eq(courses.id, id))
      .returning({ id: courses.id });
    if (!deleted.length) throw new NotFoundException('Course not found');
  }

  private async courseValues(request: CourseRequest, today: string) {
    const step = request.stepId
      ? checkStep(request.stepId, await this.scout.catalogue())
      : null;
    if (request.platformId) {
      const [platform] = await this.db
        .select({ id: trainingPlatforms.id })
        .from(trainingPlatforms)
        .where(eq(trainingPlatforms.id, request.platformId));
      if (!platform) throw new BadRequestException('Unknown platform');
    }
    const status = request.status ?? 'planned';
    const completed = status === 'completed';
    return {
      title: request.title,
      platformId: request.platformId ?? null,
      url: request.url ?? null,
      topic: request.topic ?? step?.topic ?? 'other',
      stepId: request.stepId ?? null,
      status,
      progress: completed ? 100 : (request.progress ?? 0),
      hours: request.hours ?? null,
      cost: request.cost ?? null,
      startedOn:
        request.startedOn ??
        (status === 'in_progress' || completed ? today : null),
      completedOn: request.completedOn ?? (completed ? today : null),
      certificateUrl: request.certificateUrl ?? null,
      notes: request.notes ?? null,
    };
  }

  // ---- certifications ------------------------------------------------------

  async addCertification(
    request: CertificationRequest,
  ): Promise<{ id: string }> {
    const [row] = await this.db
      .insert(certifications)
      .values(certificationValues(request))
      .returning({ id: certifications.id });
    return row;
  }

  async updateCertification(
    id: string,
    request: CertificationRequest,
  ): Promise<void> {
    const updated = await this.db
      .update(certifications)
      .set(certificationValues(request))
      .where(eq(certifications.id, id))
      .returning({ id: certifications.id });
    if (!updated.length) throw new NotFoundException('Certification not found');
  }

  async removeCertification(id: string): Promise<void> {
    const deleted = await this.db
      .delete(certifications)
      .where(eq(certifications.id, id))
      .returning({ id: certifications.id });
    if (!deleted.length) throw new NotFoundException('Certification not found');
  }

  // ---- sessions ------------------------------------------------------------

  /**
   * Logs study time. A session on a step counts for its path and topic, and
   * starts the step (and follows its path) if you had not yet.
   */
  async addSession(request: StudySessionRequest): Promise<{ id: string }> {
    const catalogue =
      request.stepId || request.pathId ? await this.scout.catalogue() : [];
    const step = request.stepId ? checkStep(request.stepId, catalogue) : null;
    let topic: StudyTopic = request.topic ?? step?.topic ?? 'other';
    if (request.courseId) {
      const [course] = await this.db
        .select({ topic: courses.topic })
        .from(courses)
        .where(eq(courses.id, request.courseId));
      if (!course) throw new BadRequestException('Unknown course');
      if (!request.topic && !step) topic = course.topic;
    }
    const pathId = step?.pathId ?? request.pathId ?? null;
    if (!step && pathId && !learningPath(pathId, catalogue))
      throw new BadRequestException('Unknown path');
    if (!request.topic && !step && pathId)
      topic = learningPath(pathId, catalogue)?.topic ?? topic;
    return this.svc.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(studySessions)
        .values({
          date: request.date,
          minutes: request.minutes,
          topic,
          pathId,
          stepId: request.stepId ?? null,
          courseId: request.courseId ?? null,
          note: request.note ?? null,
        })
        .returning({ id: studySessions.id });
      if (step) {
        await tx
          .insert(stepProgress)
          .values({
            stepId: step.stepId,
            pathId: step.pathId,
            status: 'doing',
            startedOn: request.date,
          })
          .onConflictDoNothing();
        await tx
          .insert(pathProgress)
          .values({
            pathId: step.pathId,
            status: 'following',
            startedOn: request.date,
          })
          .onConflictDoNothing();
      }
      return row;
    });
  }

  async removeSession(id: string): Promise<void> {
    const deleted = await this.db
      .delete(studySessions)
      .where(eq(studySessions.id, id))
      .returning({ id: studySessions.id });
    if (!deleted.length) throw new NotFoundException('Session not found');
  }

  // ---- paths ---------------------------------------------------------------

  /** Follow, pause or stop a path (null); your step progress is kept. */
  async setPath(
    pathId: string,
    request: PathProgressRequest,
    today = localToday(),
  ): Promise<void> {
    if (
      !learningPath(pathId, await this.scout.catalogue()) &&
      !learningPath(pathId, LEARNING_PATHS)
    )
      throw new NotFoundException('Path not found');
    if (request.status === null) {
      await this.db.delete(pathProgress).where(eq(pathProgress.pathId, pathId));
      return;
    }
    await this.db
      .insert(pathProgress)
      .values({
        pathId,
        status: request.status,
        startedOn: today,
        targetOn: request.targetOn ?? null,
        scoutWatch: request.watch ?? true,
      })
      .onConflictDoUpdate({
        target: pathProgress.pathId,
        set: {
          status: request.status,
          ...(request.targetOn !== undefined
            ? { targetOn: request.targetOn }
            : {}),
          ...(request.watch !== undefined ? { scoutWatch: request.watch } : {}),
        },
      });
    // A path you start following (or watch again) gets its first scan soon.
    if (request.status === 'following') this.scout.soon();
  }

  /**
   * Add a topic: a curated template, or a path you wrote (its id is a slug
   * of its name). Either way you follow it from today.
   */
  async addPath(
    request: PathCreateRequest,
    today = localToday(),
  ): Promise<{ id: string }> {
    const catalogue = await this.scout.catalogue();
    if ('template' in request) {
      const id = request.template;
      if (!learningPath(id, LEARNING_PATHS))
        throw new NotFoundException('Path not found');
      if (learningPath(id, catalogue))
        throw new ConflictException('This path is already yours.');
      await this.db
        .insert(pathProgress)
        .values({ pathId: id, status: 'following', startedOn: today })
        .onConflictDoNothing();
      this.scout.soon();
      return { id };
    }
    const stored = await this.db
      .select({ id: learningPaths.id })
      .from(learningPaths);
    const taken = new Set([
      ...LEARNING_PATHS.map((p) => p.id),
      ...catalogue.map((p) => p.id),
      ...stored.map((p) => p.id),
    ]);
    const id = freeId(pathSlug(request.outline.name), taken);
    const path = outlinePath(id, request.outline);
    await this.svc.db.transaction(async (tx) => {
      await tx.insert(learningPaths).values({ ...path, templateId: null });
      await tx
        .insert(pathProgress)
        .values({ pathId: id, status: 'following', startedOn: today })
        .onConflictDoNothing();
    });
    this.scout.soon();
    return { id };
  }

  /** The path builder's draft for a topic: shown in the editor, not saved. */
  draftPath(
    request: PathBuilderRequest,
    today = localToday(),
  ): Promise<{ outline: PathOutlineRequest; model: string }> {
    return this.builder.draft(request, today);
  }

  /**
   * Saves a path's card, stages and steps as you wrote them. A curated path
   * you change becomes yours (a row with its id); a step you keep keeps its
   * progress, and a step you drop keeps it too, should you bring it back.
   */
  async editPath(pathId: string, outline: PathOutlineRequest): Promise<void> {
    const catalogue = await this.scout.catalogue();
    if (!learningPath(pathId, catalogue))
      throw new NotFoundException('Path not found');
    const path = outlinePath(pathId, outline);
    const templateId = learningPath(pathId, LEARNING_PATHS) ? pathId : null;
    const now = new Date();
    await this.db
      .insert(learningPaths)
      .values({ ...path, templateId, updatedAt: now })
      .onConflictDoUpdate({
        target: learningPaths.id,
        set: { ...path, updatedAt: now },
      });
  }

  /**
   * Removes a path from yours with your progress on its steps; the sessions
   * you logged stay. A path you wrote goes with everything the scout found
   * for it; a curated one keeps what you pinned, should you add it again.
   */
  async removePath(pathId: string): Promise<void> {
    const catalogue = await this.scout.catalogue();
    if (!learningPath(pathId, catalogue))
      throw new NotFoundException('Path not found');
    const curated = Boolean(learningPath(pathId, LEARNING_PATHS));
    await this.svc.db.transaction(async (tx) => {
      await tx.delete(pathProgress).where(eq(pathProgress.pathId, pathId));
      await tx.delete(stepProgress).where(eq(stepProgress.pathId, pathId));
      await tx.delete(learningPaths).where(eq(learningPaths.id, pathId));
      if (curated) {
        await tx
          .delete(outlineChanges)
          .where(
            and(
              eq(outlineChanges.pathId, pathId),
              eq(outlineChanges.status, 'proposed'),
            ),
          );
        await tx
          .delete(scoutResources)
          .where(
            and(
              eq(scoutResources.pathId, pathId),
              inArray(scoutResources.status, ['suggested']),
            ),
          );
      } else {
        await tx
          .delete(outlineChanges)
          .where(eq(outlineChanges.pathId, pathId));
        await tx
          .delete(scoutResources)
          .where(eq(scoutResources.pathId, pathId));
        await tx.delete(scoutSteps).where(eq(scoutSteps.pathId, pathId));
      }
    });
  }

  /** Marks a step not started, studying or done, with your notes. */
  async setStep(
    stepId: string,
    request: StepProgressRequest,
    today = localToday(),
  ): Promise<void> {
    const step = stepPath(stepId, await this.scout.catalogue());
    if (!step) throw new NotFoundException('Step not found');
    const [current] = await this.db
      .select()
      .from(stepProgress)
      .where(eq(stepProgress.stepId, stepId));
    const notes =
      request.notes !== undefined ? request.notes : (current?.notes ?? null);
    if (request.status === 'todo' && !notes) {
      await this.db.delete(stepProgress).where(eq(stepProgress.stepId, stepId));
      return;
    }
    const values = {
      stepId,
      pathId: step.id,
      status: request.status,
      startedOn:
        request.status === 'todo' ? null : (current?.startedOn ?? today),
      doneOn: request.status === 'done' ? (current?.doneOn ?? today) : null,
      notes,
    };
    await this.svc.db.transaction(async (tx) => {
      await tx
        .insert(stepProgress)
        .values(values)
        .onConflictDoUpdate({ target: stepProgress.stepId, set: values });
      if (request.status !== 'todo')
        await tx
          .insert(pathProgress)
          .values({ pathId: step.id, status: 'following', startedOn: today })
          .onConflictDoNothing();
    });
  }

  // ---- coach ---------------------------------------------------------------

  async writePlan(
    request: StudyPlanRequest,
    today = localToday(),
  ): Promise<StudyPlanDto> {
    const overview = await this.overview(today);
    const question = request.question?.trim() || null;
    const written = await this.coach.plan(
      {
        paths: overview.paths,
        courses: overview.courses,
        certifications: overview.certifications,
        stats: overview.stats,
        reminders: overview.reminders,
        hours: request.hours ?? null,
        today,
        catalogue: overview.catalogue,
      },
      question,
    );
    const [row] = await this.db
      .insert(studyPlans)
      .values({
        question,
        output: written.output,
        source: written.source,
        model: written.model,
      })
      .returning();
    // Keep the last 20 plans.
    await this.db.execute(
      sql`delete from ${studyPlans} where id not in (select id from ${studyPlans} order by created_at desc limit 20)`,
    );
    return planDto(row);
  }

  async removePlan(id: string): Promise<void> {
    const deleted = await this.db
      .delete(studyPlans)
      .where(eq(studyPlans.id, id))
      .returning({ id: studyPlans.id });
    if (!deleted.length) throw new NotFoundException('Plan not found');
  }
}

/**
 * The path a step belongs to: one of yours, else a curated one (a session
 * or a status on its step adds it to yours).
 */
function stepPath(
  stepId: string,
  catalogue: readonly LearningPath[],
): LearningPath | undefined {
  for (const paths of [catalogue, LEARNING_PATHS])
    if (pathStep(stepId, paths)) return pathOfStep(stepId, paths);
  return undefined;
}

/** The step and its path, or a 400 for an id not in the catalog. */
function checkStep(
  stepId: string,
  catalogue: readonly LearningPath[],
): {
  stepId: string;
  pathId: string;
  topic: StudyTopic;
} {
  const path = stepPath(stepId, catalogue);
  if (!path) throw new BadRequestException(`Unknown path step ${stepId}`);
  return { stepId, pathId: path.id, topic: path.topic };
}

function platformValues(request: TrainingPlatformRequest) {
  const plan = request.plan ?? 'free';
  const subscription = plan === 'subscription';
  return {
    name: request.name,
    url: request.url,
    account: request.account ?? null,
    plan,
    status: request.status ?? 'active',
    price: subscription ? (request.price ?? null) : null,
    billingPeriod: subscription ? (request.billingPeriod ?? 'year') : null,
    renewsOn: subscription ? (request.renewsOn ?? null) : null,
    topics: [...new Set(request.topics ?? [])],
    notes: request.notes ?? null,
  };
}

function certificationValues(request: CertificationRequest) {
  return {
    name: request.name,
    provider: request.provider ?? null,
    topic: request.topic ?? 'other',
    status: request.status ?? 'planned',
    examOn: request.examOn ?? null,
    cost: request.cost ?? null,
    obtainedOn: request.obtainedOn ?? null,
    expiresOn: request.expiresOn ?? null,
    credentialUrl: request.credentialUrl ?? null,
    notes: request.notes ?? null,
  };
}

export function platformDto(
  row: TrainingPlatformRow,
  courseCount: number,
): TrainingPlatformDto {
  const base = {
    plan: row.plan,
    price: row.price,
    billingPeriod: row.billingPeriod,
  };
  return {
    id: row.id,
    name: row.name,
    url: row.url,
    account: row.account,
    plan: row.plan,
    status: row.status,
    price: row.price,
    billingPeriod: row.billingPeriod,
    renewsOn: row.renewsOn,
    yearlyCost: yearlyCost(base),
    topics: row.topics,
    notes: row.notes,
    lastOpenedAt: iso(row.lastOpenedAt),
    createdAt: row.createdAt.toISOString(),
    courses: courseCount,
  };
}

function courseDto(
  row: CourseRow,
  platformName: Map<string, string>,
  minutes: number,
): CourseDto {
  return {
    id: row.id,
    title: row.title,
    platformId: row.platformId,
    platformName: row.platformId
      ? (platformName.get(row.platformId) ?? null)
      : null,
    url: row.url,
    topic: row.topic,
    stepId: row.stepId,
    status: row.status,
    progress: row.progress,
    hours: row.hours,
    hoursLogged: Math.round((minutes / 60) * 10) / 10,
    cost: row.cost,
    startedOn: row.startedOn,
    completedOn: row.completedOn,
    certificateUrl: row.certificateUrl,
    notes: row.notes,
    createdAt: row.createdAt.toISOString(),
  };
}

function certificationDto(row: CertificationRow): CertificationDto {
  return {
    id: row.id,
    name: row.name,
    provider: row.provider,
    topic: row.topic,
    status: row.status,
    examOn: row.examOn,
    cost: row.cost,
    obtainedOn: row.obtainedOn,
    expiresOn: row.expiresOn,
    credentialUrl: row.credentialUrl,
    notes: row.notes,
    createdAt: row.createdAt.toISOString(),
  };
}

function sessionDto(row: StudySessionRow): StudySessionDto {
  return {
    id: row.id,
    date: row.date,
    minutes: row.minutes,
    topic: row.topic,
    pathId: row.pathId,
    stepId: row.stepId,
    courseId: row.courseId,
    note: row.note,
  };
}

function planDto(row: StudyPlanRow): StudyPlanDto {
  return {
    id: row.id,
    question: row.question,
    output: row.output,
    source: row.source,
    model: row.model,
    createdAt: row.createdAt.toISOString(),
  };
}
