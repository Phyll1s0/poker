/// <reference types="vite/client" />

import {
  materializeThreeWayRiverCoachRequest,
  solveMaterializedThreeWayRiverCoachDecision,
  type ThreeWayRiverCoachAsyncOptions,
  type ThreeWayRiverCoachRequest,
  type ThreeWayRiverCoachResult,
} from "./poker-threeway-river-coach.ts";
import type {
  ThreeWayRiverWorkerRequest,
  ThreeWayRiverWorkerResponse,
} from "./poker-threeway-river-worker-protocol.ts";
import ThreeWayRiverSolverWorker from "./poker-threeway-river.worker.ts?worker";

let requestSequence = 0;

function abortedError(): Error {
  const error = new Error("三人河牌求解已取消");
  error.name = "AbortError";
  return error;
}

function deepFreezeClone<T>(value: T, seen = new Set<object>()): T {
  if (value === null || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  for (const nested of Object.values(value)) deepFreezeClone(nested, seen);
  return Object.freeze(value);
}

/**
 * Runs the expensive multi-resolution solve off the table's main thread.
 * Unsupported Worker environments retain a cooperative in-process fallback.
 */
export async function solveThreeWayRiverCoachDecisionInWorker(
  request: ThreeWayRiverCoachRequest,
  options: ThreeWayRiverCoachAsyncOptions = {},
): Promise<ThreeWayRiverCoachResult> {
  if (options.signal?.aborted) throw abortedError();
  // Give React one paint before enumerating the public range weights needed
  // for structured clone. The enumeration is intentionally public-only and
  // does not read either opponent's dealt cards.
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  if (options.signal?.aborted) throw abortedError();
  const materialized = materializeThreeWayRiverCoachRequest(request);
  if (typeof Worker === "undefined") {
    return solveMaterializedThreeWayRiverCoachDecision(materialized, options);
  }

  let worker: Worker;
  try {
    // Vite's explicit Worker constructor keeps both vinext/Sites and the
    // GitHub Pages build on a bundled JavaScript asset. A bare new URL() is
    // rewritten by vinext against file:///ROOT and cannot run in browsers.
    worker = new ThreeWayRiverSolverWorker({
      name: "rangecraft-three-way-river-solver",
    });
  } catch {
    return solveMaterializedThreeWayRiverCoachDecision(materialized, options);
  }
  requestSequence += 1;
  const requestId = `river3-${Date.now()}-${requestSequence}`;

  return new Promise<ThreeWayRiverCoachResult>((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      options.signal?.removeEventListener("abort", onAbort);
      worker.terminate();
      callback();
    };
    const onAbort = () => {
      const cancel: ThreeWayRiverWorkerRequest = { type: "cancel", requestId };
      try {
        worker.postMessage(cancel);
      } catch {
        // terminate() below is the authoritative cancellation path.
      }
      finish(() => reject(abortedError()));
    };
    options.signal?.addEventListener("abort", onAbort, { once: true });
    worker.addEventListener("message", (event: MessageEvent<ThreeWayRiverWorkerResponse>) => {
      if (settled) return;
      const message = event.data;
      if (!message || message.requestId !== requestId) return;
      if (message.type === "progress") {
        options.onProgress?.(message.progress);
        return;
      }
      if (message.type === "result") {
        // Structured clone deliberately drops Object.freeze. Restore the
        // runtime-readonly result invariant before exposing it to the UI.
        finish(() => resolve(deepFreezeClone(message.result)));
        return;
      }
      finish(() => reject(message.aborted ? abortedError() : new Error(message.error)));
    });
    worker.addEventListener("error", () => {
      // A module Worker may construct successfully but fail asynchronously
      // because its script is unavailable or blocked. Preserve functionality
      // with the same cooperative fallback used for unsupported environments.
      finish(() => {
        if (options.signal?.aborted) {
          reject(abortedError());
          return;
        }
        void solveMaterializedThreeWayRiverCoachDecision(materialized, options)
          .then(resolve, reject);
      });
    });
    const solve: ThreeWayRiverWorkerRequest = { type: "solve", requestId, request: materialized };
    try {
      worker.postMessage(solve);
    } catch {
      finish(() => {
        if (options.signal?.aborted) {
          reject(abortedError());
          return;
        }
        void solveMaterializedThreeWayRiverCoachDecision(materialized, options)
          .then(resolve, reject);
      });
    }
  });
}
