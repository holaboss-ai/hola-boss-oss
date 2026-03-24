import { executePythonJson } from "./python-executor.js";

export interface AppLifecycleActionResult {
  app_id: string;
  status: string;
  detail: string;
  ports: Record<string, number>;
}

export interface LifecycleShutdownResult {
  stopped: string[];
  failed: string[];
}

export interface AppLifecycleExecutorLike {
  startApp(params: { workspaceId: string; appId: string }): Promise<AppLifecycleActionResult>;
  stopApp(params: { workspaceId: string; appId: string }): Promise<AppLifecycleActionResult>;
  shutdownAll(): Promise<LifecycleShutdownResult>;
}

export class AppLifecycleExecutorError extends Error {
  readonly statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.statusCode = statusCode;
  }
}

export async function executeAppLifecycleActionWithPython(params: {
  action: "start" | "stop";
  workspaceId: string;
  appId: string;
}): Promise<AppLifecycleActionResult> {
  const envelope = await executePythonJson<AppLifecycleActionResult>({
    moduleName: "sandbox_agent_runtime.app_lifecycle_executor",
    args: [
      "--action",
      params.action,
      "--workspace-id",
      params.workspaceId,
      "--app-id",
      params.appId
    ],
    payload: {},
    invalidResponseMessage: "invalid lifecycle executor response",
    nonZeroExitMessage: "python app lifecycle executor exited with code"
  });

  if ((envelope.status_code ?? 500) >= 400) {
    throw new AppLifecycleExecutorError(envelope.status_code, envelope.detail ?? "app lifecycle request failed");
  }
  if (!envelope.payload) {
    throw new Error("missing lifecycle executor payload");
  }
  return envelope.payload;
}

export class PythonAppLifecycleExecutor implements AppLifecycleExecutorLike {
  async startApp(params: { workspaceId: string; appId: string }): Promise<AppLifecycleActionResult> {
    return await executeAppLifecycleActionWithPython({
      action: "start",
      workspaceId: params.workspaceId,
      appId: params.appId
    });
  }

  async stopApp(params: { workspaceId: string; appId: string }): Promise<AppLifecycleActionResult> {
    return await executeAppLifecycleActionWithPython({
      action: "stop",
      workspaceId: params.workspaceId,
      appId: params.appId
    });
  }

  async shutdownAll(): Promise<LifecycleShutdownResult> {
    const envelope = await executePythonJson<LifecycleShutdownResult>({
      moduleName: "sandbox_agent_runtime.lifecycle_shutdown_executor",
      payload: {},
      invalidResponseMessage: "invalid lifecycle shutdown executor response",
      nonZeroExitMessage: "python lifecycle shutdown executor exited with code"
    });

    if ((envelope.status_code ?? 500) >= 400) {
      throw new AppLifecycleExecutorError(envelope.status_code, envelope.detail ?? "lifecycle shutdown failed");
    }
    if (!envelope.payload) {
      throw new Error("missing lifecycle shutdown payload");
    }
    return envelope.payload as unknown as LifecycleShutdownResult;
  }
}
