import type {
  MaterializedThreeWayRiverCoachRequest,
  ThreeWayRiverCoachProgress,
  ThreeWayRiverCoachResult,
} from "./poker-threeway-river-coach.ts";

export type ThreeWayRiverWorkerRequest =
  | Readonly<{
      type: "solve";
      requestId: string;
      request: MaterializedThreeWayRiverCoachRequest;
    }>
  | Readonly<{
      type: "cancel";
      requestId: string;
    }>;

export type ThreeWayRiverWorkerResponse =
  | Readonly<{
      type: "progress";
      requestId: string;
      progress: ThreeWayRiverCoachProgress;
    }>
  | Readonly<{
      type: "result";
      requestId: string;
      result: ThreeWayRiverCoachResult;
    }>
  | Readonly<{
      type: "error";
      requestId: string;
      error: string;
      aborted: boolean;
    }>;
