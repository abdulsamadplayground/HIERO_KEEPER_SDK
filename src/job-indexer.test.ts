// @hiero/keeper — JobIndexer unit tests and property tests

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { JobIndexer } from "./job-indexer.js";
import type { Job, JobStatus } from "./types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const STATUSES: JobStatus[] = ["PENDING", "EXECUTED", "EXPIRED", "FAILED"];

function makeJob(overrides: Partial<Job> = {}): Job {
  return {
    scheduleId: overrides.scheduleId ?? `0.0.${Math.floor(Math.random() * 100000)}`,
    targetContractId: overrides.targetContractId ?? "0.0.999",
    calldata: overrides.calldata ?? "0xdeadbeef",
    scheduledAt: overrides.scheduledAt ?? new Date().toISOString(),
    executeAfterSeconds: overrides.executeAfterSeconds ?? 60,
    rewardHbar: overrides.rewardHbar ?? 1,
    status: overrides.status ?? "PENDING",
  };
}

// fast-check arbitrary for Job
const arbJobStatus: fc.Arbitrary<JobStatus> = fc.constantFrom(...STATUSES);

const arbContractId: fc.Arbitrary<string> = fc
  .nat({ max: 99999 })
  .map((n) => `0.0.${n}`);

const arbJob: fc.Arbitrary<Job> = fc
  .record({
    scheduleId: fc.nat({ max: 999999 }).map((n) => `0.0.${n}`),
    targetContractId: arbContractId,
    calldata: fc.hexaString({ minLength: 2, maxLength: 20 }).map((h) => `0x${h}`),
    scheduledAt: fc
      .date({ min: new Date("2020-01-01"), max: new Date("2030-01-01") })
      .map((d) => d.toISOString()),
    executeAfterSeconds: fc.nat({ max: 86400 }),
    rewardHbar: fc.nat({ max: 1000 }),
    status: arbJobStatus,
  })
  .map((r) => r as Job);

// Generate a list of jobs with unique scheduleIds
const arbUniqueJobs = (minLen = 0, maxLen = 50): fc.Arbitrary<Job[]> =>
  fc
    .uniqueArray(fc.nat({ max: 999999 }), { minLength: minLen, maxLength: maxLen })
    .chain((ids) =>
      fc.tuple(...ids.map((id) =>
        arbJob.map((j) => ({ ...j, scheduleId: `0.0.${id}` })),
      )),
    )
    .map((arr) => arr as Job[]);

// ---------------------------------------------------------------------------
// Unit Tests (Task 10.3)
// ---------------------------------------------------------------------------

describe("JobIndexer", () => {
  describe("unit tests", () => {
    it("returns empty data for empty collection", () => {
      const indexer = new JobIndexer();
      const result = indexer.getJobs();
      expect(result.data).toEqual([]);
      expect(result.totalCount).toBe(0);
      expect(result.page).toBe(1);
      expect(result.totalPages).toBe(1);
      expect(result.pageSize).toBe(25);
      expect(result.links.next).toBeNull();
    });

    it("returns all jobs on a single page when count <= limit", () => {
      const indexer = new JobIndexer();
      const jobs = Array.from({ length: 5 }, (_, i) =>
        makeJob({ scheduleId: `0.0.${i}`, scheduledAt: `2024-01-0${i + 1}T00:00:00.000Z` }),
      );
      for (const j of jobs) indexer.addJob(j);

      const result = indexer.getJobs({ limit: 10 });
      expect(result.data).toHaveLength(5);
      expect(result.totalCount).toBe(5);
      expect(result.totalPages).toBe(1);
      expect(result.links.next).toBeNull();
    });

    it("handles exact page boundary (N items, limit=N)", () => {
      const indexer = new JobIndexer();
      const jobs = Array.from({ length: 10 }, (_, i) =>
        makeJob({ scheduleId: `0.0.${i}`, scheduledAt: `2024-01-${String(i + 1).padStart(2, "0")}T00:00:00.000Z` }),
      );
      for (const j of jobs) indexer.addJob(j);

      const result = indexer.getJobs({ limit: 10, page: 1 });
      expect(result.data).toHaveLength(10);
      expect(result.totalCount).toBe(10);
      expect(result.totalPages).toBe(1);
      expect(result.links.next).toBeNull();
    });

    it("paginates correctly across multiple pages", () => {
      const indexer = new JobIndexer();
      const jobs = Array.from({ length: 7 }, (_, i) =>
        makeJob({ scheduleId: `0.0.${i}`, scheduledAt: `2024-01-${String(i + 1).padStart(2, "0")}T00:00:00.000Z` }),
      );
      for (const j of jobs) indexer.addJob(j);

      const page1 = indexer.getJobs({ limit: 3, page: 1 });
      expect(page1.data).toHaveLength(3);
      expect(page1.totalPages).toBe(3);
      expect(page1.links.next).not.toBeNull();

      const page2 = indexer.getJobs({ limit: 3, page: 2 });
      expect(page2.data).toHaveLength(3);

      const page3 = indexer.getJobs({ limit: 3, page: 3 });
      expect(page3.data).toHaveLength(1);
      expect(page3.links.next).toBeNull();
    });

    it("sorts by scheduledAt descending", () => {
      const indexer = new JobIndexer();
      indexer.addJob(makeJob({ scheduleId: "0.0.1", scheduledAt: "2024-01-01T00:00:00.000Z" }));
      indexer.addJob(makeJob({ scheduleId: "0.0.2", scheduledAt: "2024-06-15T00:00:00.000Z" }));
      indexer.addJob(makeJob({ scheduleId: "0.0.3", scheduledAt: "2024-03-10T00:00:00.000Z" }));

      const result = indexer.getJobs();
      expect(result.data[0].scheduledAt).toBe("2024-06-15T00:00:00.000Z");
      expect(result.data[1].scheduledAt).toBe("2024-03-10T00:00:00.000Z");
      expect(result.data[2].scheduledAt).toBe("2024-01-01T00:00:00.000Z");
    });

    it("filters by status", () => {
      const indexer = new JobIndexer();
      indexer.addJob(makeJob({ scheduleId: "0.0.1", status: "PENDING" }));
      indexer.addJob(makeJob({ scheduleId: "0.0.2", status: "EXECUTED" }));
      indexer.addJob(makeJob({ scheduleId: "0.0.3", status: "PENDING" }));

      const result = indexer.getJobs({ status: "PENDING" });
      expect(result.data).toHaveLength(2);
      expect(result.data.every((j) => j.status === "PENDING")).toBe(true);
      expect(result.totalCount).toBe(2);
    });

    it("filters by targetContractId", () => {
      const indexer = new JobIndexer();
      indexer.addJob(makeJob({ scheduleId: "0.0.1", targetContractId: "0.0.100" }));
      indexer.addJob(makeJob({ scheduleId: "0.0.2", targetContractId: "0.0.200" }));
      indexer.addJob(makeJob({ scheduleId: "0.0.3", targetContractId: "0.0.100" }));

      const result = indexer.getJobs({ targetContractId: "0.0.100" });
      expect(result.data).toHaveLength(2);
      expect(result.data.every((j) => j.targetContractId === "0.0.100")).toBe(true);
    });

    it("filters by time range (scheduledAfter + scheduledBefore)", () => {
      const indexer = new JobIndexer();
      indexer.addJob(makeJob({ scheduleId: "0.0.1", scheduledAt: "2024-01-01T00:00:00.000Z" }));
      indexer.addJob(makeJob({ scheduleId: "0.0.2", scheduledAt: "2024-06-15T00:00:00.000Z" }));
      indexer.addJob(makeJob({ scheduleId: "0.0.3", scheduledAt: "2024-12-31T00:00:00.000Z" }));

      const result = indexer.getJobs({
        scheduledAfter: "2024-03-01T00:00:00.000Z",
        scheduledBefore: "2024-09-01T00:00:00.000Z",
      });
      expect(result.data).toHaveLength(1);
      expect(result.data[0].scheduleId).toBe("0.0.2");
    });

    it("combines multiple filters with AND logic", () => {
      const indexer = new JobIndexer();
      indexer.addJob(makeJob({ scheduleId: "0.0.1", status: "PENDING", targetContractId: "0.0.100", scheduledAt: "2024-06-01T00:00:00.000Z" }));
      indexer.addJob(makeJob({ scheduleId: "0.0.2", status: "EXECUTED", targetContractId: "0.0.100", scheduledAt: "2024-06-15T00:00:00.000Z" }));
      indexer.addJob(makeJob({ scheduleId: "0.0.3", status: "PENDING", targetContractId: "0.0.200", scheduledAt: "2024-06-10T00:00:00.000Z" }));
      indexer.addJob(makeJob({ scheduleId: "0.0.4", status: "PENDING", targetContractId: "0.0.100", scheduledAt: "2024-01-01T00:00:00.000Z" }));

      const result = indexer.getJobs({
        status: "PENDING",
        targetContractId: "0.0.100",
        scheduledAfter: "2024-05-01T00:00:00.000Z",
      });
      expect(result.data).toHaveLength(1);
      expect(result.data[0].scheduleId).toBe("0.0.1");
    });
  });

  // -------------------------------------------------------------------------
  // Property-Based Tests (Task 10.4)
  // -------------------------------------------------------------------------

  describe("property tests", () => {
    // Feature: hiero-keeper-sdk, Property 11: Job pagination metadata correctness
    // **Validates: Requirements 7.1, 7.4**
    it("Property 11: pagination metadata is correct for any N jobs and valid (limit, page)", () => {
      fc.assert(
        fc.property(
          arbUniqueJobs(0, 50),
          fc.integer({ min: 1, max: 25 }),
          fc.integer({ min: 1, max: 10 }),
          (jobs, limit, page) => {
            const indexer = new JobIndexer();
            for (const j of jobs) indexer.addJob(j);

            const n = jobs.length;
            const expectedTotalPages = Math.max(1, Math.ceil(n / limit));

            const result = indexer.getJobs({ limit, page });

            // totalCount equals N
            expect(result.totalCount).toBe(n);
            // totalPages equals ceil(N / limit)
            expect(result.totalPages).toBe(expectedTotalPages);
            // page equals requested page
            expect(result.page).toBe(page);
            // pageSize equals limit
            expect(result.pageSize).toBe(limit);
            // returned items <= limit
            expect(result.data.length).toBeLessThanOrEqual(limit);

            // Correct slice: if page is within range, data length should match
            if (page <= expectedTotalPages) {
              const start = (page - 1) * limit;
              const expectedLen = Math.min(limit, n - start);
              expect(result.data.length).toBe(expectedLen);
            } else {
              // Page beyond range returns empty
              expect(result.data.length).toBe(0);
            }
          },
        ),
        { numRuns: 100 },
      );
    });

    // Feature: hiero-keeper-sdk, Property 12: Job sort order
    // **Validates: Requirements 7.2**
    it("Property 12: jobs are sorted by scheduledAt descending", () => {
      fc.assert(
        fc.property(
          arbUniqueJobs(0, 50),
          fc.integer({ min: 1, max: 25 }),
          fc.integer({ min: 1, max: 5 }),
          (jobs, limit, page) => {
            const indexer = new JobIndexer();
            for (const j of jobs) indexer.addJob(j);

            const result = indexer.getJobs({ limit, page });

            for (let i = 0; i < result.data.length - 1; i++) {
              expect(result.data[i].scheduledAt >= result.data[i + 1].scheduledAt).toBe(true);
            }
          },
        ),
        { numRuns: 100 },
      );
    });

    // Feature: hiero-keeper-sdk, Property 13: Job filter correctness
    // **Validates: Requirements 7.3**
    it("Property 13: every returned job matches all filters and no excluded job matches all filters", () => {
      fc.assert(
        fc.property(
          arbUniqueJobs(0, 30),
          fc.record({
            status: fc.option(arbJobStatus, { nil: undefined }),
            targetContractId: fc.option(arbContractId, { nil: undefined }),
            scheduledAfter: fc.option(
              fc.date({ min: new Date("2020-01-01"), max: new Date("2030-01-01") }).map((d) => d.toISOString()),
              { nil: undefined },
            ),
            scheduledBefore: fc.option(
              fc.date({ min: new Date("2020-01-01"), max: new Date("2030-01-01") }).map((d) => d.toISOString()),
              { nil: undefined },
            ),
          }),
          (jobs, filters) => {
            const indexer = new JobIndexer();
            for (const j of jobs) indexer.addJob(j);

            // Use a high limit to get all results in one page
            const result = indexer.getJobs({ ...filters, limit: 1000, page: 1 });

            const matchesAll = (job: Job): boolean => {
              if (filters.status !== undefined && job.status !== filters.status) return false;
              if (filters.targetContractId !== undefined && job.targetContractId !== filters.targetContractId) return false;
              if (filters.scheduledAfter !== undefined && job.scheduledAt < filters.scheduledAfter) return false;
              if (filters.scheduledBefore !== undefined && job.scheduledAt > filters.scheduledBefore) return false;
              return true;
            };

            // Every returned job matches all filters
            for (const job of result.data) {
              expect(matchesAll(job)).toBe(true);
            }

            // No excluded job matches all filters
            const returnedIds = new Set(result.data.map((j) => j.scheduleId));
            for (const job of jobs) {
              if (!returnedIds.has(job.scheduleId) && matchesAll(job)) {
                // This job matches all filters but was excluded — fail
                expect(true).toBe(false);
              }
            }
          },
        ),
        { numRuns: 100 },
      );
    });
  });
});
