import { executePythonJson } from "./python-executor.js";

export interface RuntimeConfigExecutorLike {
  getConfig(): Promise<Record<string, unknown>>;
  getStatus(): Promise<Record<string, unknown>>;
  updateConfig(payload: Record<string, unknown>): Promise<Record<string, unknown>>;
}

export class RuntimeConfigExecutorError extends Error {
  readonly statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.statusCode = statusCode;
  }
}

async function executeRuntimeConfigActionWithPython(params: {
  operation: "get-config" | "get-status" | "put-config";
  payload?: Record<string, unknown>;
}): Promise<Record<string, unknown>> {
  const envelope = await executePythonJson<Record<string, unknown>>({
    moduleName: "sandbox_agent_runtime.runtime_config_executor",
    args: ["--operation", params.operation],
    payload: params.payload ?? {},
    invalidResponseMessage: "invalid runtime config executor response",
    nonZeroExitMessage: "python runtime config executor exited with code"
  });

  if ((envelope.status_code ?? 500) >= 400) {
    throw new RuntimeConfigExecutorError(
      envelope.status_code,
      envelope.detail ?? "runtime config request failed"
    );
  }
  return envelope.payload ?? {};
}

export class PythonRuntimeConfigExecutor implements RuntimeConfigExecutorLike {
  async getConfig(): Promise<Record<string, unknown>> {
    return await executeRuntimeConfigActionWithPython({ operation: "get-config" });
  }

  async getStatus(): Promise<Record<string, unknown>> {
    return await executeRuntimeConfigActionWithPython({ operation: "get-status" });
  }

  async updateConfig(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    return await executeRuntimeConfigActionWithPython({ operation: "put-config", payload });
  }
}
