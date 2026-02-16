export type BriefStatus = "queued" | "processing" | "completed" | "failed";

export interface CreateBriefResponse {
  jobId: string;
  status: BriefStatus;
  /** Set when a cached brief already exists */
  briefId?: string;
}

export interface BriefStatusResponse {
  status: BriefStatus;
  briefId?: string;
  error?: string;
}
