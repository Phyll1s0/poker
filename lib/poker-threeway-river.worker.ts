/// <reference lib="webworker" />

import { solveMaterializedThreeWayRiverCoachDecision } from "./poker-threeway-river-coach.ts";
import type {
  ThreeWayRiverWorkerRequest,
  ThreeWayRiverWorkerResponse,
} from "./poker-threeway-river-worker-protocol.ts";

const workerScope = self as unknown as DedicatedWorkerGlobalScope;
const active = new Map<string, AbortController>();

function post(message: ThreeWayRiverWorkerResponse): void {
  workerScope.postMessage(message);
}

workerScope.addEventListener("message", (event: MessageEvent<ThreeWayRiverWorkerRequest>) => {
  const message = event.data;
  if (!message || typeof message.requestId !== "string") return;
  if (message.type === "cancel") {
    active.get(message.requestId)?.abort();
    return;
  }
  if (message.type !== "solve") return;

  active.get(message.requestId)?.abort();
  const controller = new AbortController();
  active.set(message.requestId, controller);
  void solveMaterializedThreeWayRiverCoachDecision(message.request, {
    signal: controller.signal,
    onProgress(progress) {
      if (!controller.signal.aborted) post({
        type: "progress",
        requestId: message.requestId,
        progress,
      });
    },
  }).then((result) => {
    if (!controller.signal.aborted) post({
      type: "result",
      requestId: message.requestId,
      result,
    });
  }).catch((error: unknown) => {
    const aborted = controller.signal.aborted
      || (error instanceof Error && error.name === "AbortError");
    post({
      type: "error",
      requestId: message.requestId,
      error: error instanceof Error ? error.message : "未知求解错误",
      aborted,
    });
  }).finally(() => {
    if (active.get(message.requestId) === controller) active.delete(message.requestId);
  });
});
