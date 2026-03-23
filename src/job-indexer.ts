// @hiero/keeper — JobIndexer: in-memory job storage with pagination, sorting, and filtering

import type { Job, JobQueryParams, PaginatedResponse } from "./types.js";

const DEFAULT_LIMIT = 25;
const DEFAULT_PAGE = 1;

/**
 * In-memory job index supporting pagination, descending sort by scheduledAt,
 * and filtering by status, targetContractId, and time range.
 */
export class JobIndexer {
  private readonly jobs: Map<string, Job> = new Map();

  /** Add or update a job in the index (keyed by scheduleId). */
  addJob(job: Job): void {
    this.jobs.set(job.scheduleId, job);
  }

  /** Query jobs with optional pagination and filtering. */
  getJobs(params?: JobQueryParams): PaginatedResponse<Job> {
    const limit = params?.limit ?? DEFAULT_LIMIT;
    const page = params?.page ?? DEFAULT_PAGE;

    // 1. Collect all jobs
    let filtered = Array.from(this.jobs.values());

    // 2. Apply filters (AND logic)
    if (params?.status !== undefined) {
      filtered = filtered.filter((j) => j.status === params.status);
    }
    if (params?.targetContractId !== undefined) {
      filtered = filtered.filter(
        (j) => j.targetContractId === params.targetContractId,
      );
    }
    if (params?.scheduledAfter !== undefined) {
      const after = params.scheduledAfter;
      filtered = filtered.filter(
        (j) => j.scheduledAt >= after,
      );
    }
    if (params?.scheduledBefore !== undefined) {
      const before = params.scheduledBefore;
      filtered = filtered.filter(
        (j) => j.scheduledAt <= before,
      );
    }

    // 3. Sort descending by scheduledAt (newest first)
    filtered.sort((a, b) => (a.scheduledAt > b.scheduledAt ? -1 : a.scheduledAt < b.scheduledAt ? 1 : 0));

    // 4. Pagination
    const totalCount = filtered.length;
    const totalPages = Math.max(1, Math.ceil(totalCount / limit));
    const start = (page - 1) * limit;
    const data = filtered.slice(start, start + limit);

    return {
      data,
      links: { next: page < totalPages ? `page=${page + 1}` : null },
      totalCount,
      page,
      totalPages,
      pageSize: limit,
    };
  }
}
