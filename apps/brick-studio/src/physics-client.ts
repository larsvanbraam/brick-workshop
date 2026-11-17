import { primePhysicalAssessment } from '@brick-workshop/engine';
import type { Assembly, Part, PhysicalAssessment, PhysicalOptions } from '@brick-workshop/engine';

export interface PhysicsRequest {
  id: number;
  assembly: Assembly;
  options: PhysicalOptions;
  parts: readonly Part[];
}

export type PhysicsResponse =
  | { id: number; report: PhysicalAssessment; error?: undefined }
  | { id: number; error: string; report?: undefined };

/** Rejects a request that a newer one with the same key replaced before it started. */
export class Superseded extends Error {
  constructor() {
    super('Superseded by a newer check.');
  }
}

interface Job {
  request: Omit<PhysicsRequest, 'id'>;
  key?: string;
  resolve: (report: PhysicalAssessment) => void;
  reject: (error: Error) => void;
}

const sameOptions = (first: PhysicalOptions, second: PhysicalOptions) =>
  first.data === second.data &&
  first.estimateMissingMasses === second.estimateMissingMasses &&
  first.useCatalogMasses === second.useCatalogMasses &&
  first.useDefaultStudConnection === second.useDefaultStudConnection &&
  first.fullCheck === second.fullCheck;

/**
 * Sends builds to the physics worker one at a time. Each answer is primed into the engine's
 * cache on this thread, so an edit policy checking the same assembly afterwards reuses it at
 * once. Asking again for an assembly already asked about shares that answer.
 */
export class PhysicsClient {
  private readonly worker = new Worker(new URL('./physics-worker.ts', import.meta.url), {
    type: 'module',
  });
  private readonly queue: Job[] = [];
  private running: { id: number; job: Job } | null = null;
  private nextId = 1;
  private readonly asked = new WeakMap<
    readonly unknown[],
    { options: PhysicalOptions; buildArea?: number; answer: Promise<PhysicalAssessment> }[]
  >();

  constructor() {
    this.worker.onmessage = ({ data }: MessageEvent<PhysicsResponse>) => {
      const running = this.running;
      if (!running || running.id !== data.id) return;
      this.running = null;
      if (data.report) {
        primePhysicalAssessment(
          running.job.request.assembly,
          running.job.request.options,
          data.report,
        );
        running.job.resolve(data.report);
      } else running.job.reject(new Error(data.error));
      this.pump();
    };
    this.worker.onerror = (event) => {
      event.preventDefault();
      this.running?.job.reject(new Error(event.message || 'The physics worker failed.'));
      this.running = null;
      this.pump();
    };
  }

  /**
   * The physical assessment of an assembly under these options. A `key` lets a newer request
   * replace an older one with the same key that is still waiting, as a resting pointer's preview
   * replaces the last.
   */
  assess(
    assembly: Assembly,
    options: PhysicalOptions,
    parts: readonly Part[],
    key?: string,
  ): Promise<PhysicalAssessment> {
    const earlier = this.asked
      .get(assembly.bricks)
      ?.find(
        (entry) => entry.buildArea === assembly.buildArea && sameOptions(entry.options, options),
      );
    if (earlier) return earlier.answer;
    const answer = new Promise<PhysicalAssessment>((resolve, reject) => {
      if (key)
        for (const waiting of this.queue.filter((job) => job.key === key)) {
          this.queue.splice(this.queue.indexOf(waiting), 1);
          waiting.reject(new Superseded());
        }
      this.queue.push({ request: { assembly, options, parts }, key, resolve, reject });
      this.pump();
    });
    const entries = this.asked.get(assembly.bricks) ?? [];
    entries.push({ options, buildArea: assembly.buildArea, answer });
    this.asked.set(assembly.bricks, entries);
    // A failed or replaced check can be asked for again.
    answer.catch(() => {
      const kept = this.asked.get(assembly.bricks)?.filter((entry) => entry.answer !== answer);
      if (kept) this.asked.set(assembly.bricks, kept);
    });
    return answer;
  }

  dispose(): void {
    this.worker.terminate();
    for (const job of this.queue.splice(0)) job.reject(new Superseded());
    this.running?.job.reject(new Superseded());
    this.running = null;
  }

  private pump() {
    if (this.running) return;
    const job = this.queue.shift();
    if (!job) return;
    const id = this.nextId++;
    this.running = { id, job };
    this.worker.postMessage({ id, ...job.request } satisfies PhysicsRequest);
  }
}
