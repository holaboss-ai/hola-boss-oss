import type { Readable } from "node:stream";
import { executePythonJson, executePythonStream, type ExecutorEnvelope } from "./python-executor.js";

export interface RunnerExecutorLike {
  run(payload: Record<string, unknown>): Promise<Record<string, unknown>>;
  stream(payload: Record<string, unknown>): Promise<Readable>;
}

export class RunnerExecutorError extends Error {
  readonly statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.statusCode = statusCode;
  }
}

async function executeRunnerActionWithPython(params: {
  operation: "run" | "stream";
  payload: Record<string, unknown>;
}): Promise<ExecutorEnvelope<Record<string, unknown>> | Readable> {
  if (params.operation === "stream") {
    return await executePythonStream({
      moduleName: "sandbox_agent_runtime.runner_http_executor",
      args: ["--operation", params.operation],
      payload: params.payload,
      nonZeroExitMessage: "python runner stream executor exited with code"
    });
  }

  return await executePythonJson<Record<string, unknown>>({
    moduleName: "sandbox_agent_runtime.runner_http_executor",
    args: ["--operation", params.operation],
    payload: params.payload,
    invalidResponseMessage: "invalid runner executor response",
    nonZeroExitMessage: "python runner executor exited with code"
  });
}

export class PythonRunnerExecutor implements RunnerExecutorLike {
  async run(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    const envelope = (await executeRunnerActionWithPython({
      operation: "run",
      payload
    })) as ExecutorEnvelope<Record<string, unknown>>;
    if ((envelope.status_code ?? 500) >= 400) {
      throw new RunnerExecutorError(envelope.status_code, envelope.detail ?? "runner request failed");
    }
    return envelope.payload ?? {};
  }

  async stream(payload: Record<string, unknown>): Promise<Readable> {
    return (await executeRunnerActionWithPython({
      operation: "stream",
      payload
    })) as Readable;
  }
}
