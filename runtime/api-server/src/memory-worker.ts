import { executePythonJson } from "./python-executor.js";

export interface MemoryExecutorLike {
  search(payload: Record<string, unknown>): Promise<Record<string, unknown>>;
  get(payload: Record<string, unknown>): Promise<Record<string, unknown>>;
  upsert(payload: Record<string, unknown>): Promise<Record<string, unknown>>;
  status(payload: Record<string, unknown>): Promise<Record<string, unknown>>;
  sync(payload: Record<string, unknown>): Promise<Record<string, unknown>>;
}

export class MemoryExecutorError extends Error {
  readonly statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.statusCode = statusCode;
  }
}

async function executeMemoryActionWithPython(params: {
  operation: "search" | "get" | "upsert" | "status" | "sync";
  payload: Record<string, unknown>;
}): Promise<Record<string, unknown>> {
  const envelope = await executePythonJson<Record<string, unknown>>({
    moduleName: "sandbox_agent_runtime.memory_executor",
    args: ["--operation", params.operation],
    payload: params.payload,
    invalidResponseMessage: "invalid memory executor response",
    nonZeroExitMessage: "python memory executor exited with code"
  });

  if ((envelope.status_code ?? 500) >= 400) {
    throw new MemoryExecutorError(envelope.status_code, envelope.detail ?? "memory request failed");
  }
  return envelope.payload ?? {};
}

export class PythonMemoryExecutor implements MemoryExecutorLike {
  async search(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    return await executeMemoryActionWithPython({ operation: "search", payload });
  }

  async get(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    return await executeMemoryActionWithPython({ operation: "get", payload });
  }

  async upsert(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    return await executeMemoryActionWithPython({ operation: "upsert", payload });
  }

  async status(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    return await executeMemoryActionWithPython({ operation: "status", payload });
  }

  async sync(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    return await executeMemoryActionWithPython({ operation: "sync", payload });
  }
}
