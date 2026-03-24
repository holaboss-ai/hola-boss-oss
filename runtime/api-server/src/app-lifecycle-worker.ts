import { spawn } from "node:child_process";

export interface AppLifecycleActionResult {
  app_id: string;
  status: string;
  detail: string;
  ports: Record<string, number>;
}

export interface AppLifecycleExecutorLike {
  startApp(params: { workspaceId: string; appId: string }): Promise<AppLifecycleActionResult>;
  stopApp(params: { workspaceId: string; appId: string }): Promise<AppLifecycleActionResult>;
}

type ExecutorEnvelope = {
  status_code: number;
  payload?: AppLifecycleActionResult;
  detail?: string | null;
};

export class AppLifecycleExecutorError extends Error {
  readonly statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.statusCode = statusCode;
  }
}

function runtimeAppRoot(): string {
  const configured = (process.env.HOLABOSS_RUNTIME_APP_ROOT ?? "").trim();
  return configured || process.cwd();
}

function runtimePythonBin(): string {
  const configured = (process.env.HOLABOSS_RUNTIME_PYTHON ?? "").trim();
  return configured || "python";
}

export async function executeAppLifecycleActionWithPython(params: {
  action: "start" | "stop";
  workspaceId: string;
  appId: string;
}): Promise<AppLifecycleActionResult> {
  const cwd = runtimeAppRoot();
  const pythonBin = runtimePythonBin();
  const envelope = await new Promise<ExecutorEnvelope>((resolve, reject) => {
    const child = spawn(
      pythonBin,
      [
        "-m",
        "sandbox_agent_runtime.app_lifecycle_executor",
        "--action",
        params.action,
        "--workspace-id",
        params.workspaceId,
        "--app-id",
        params.appId
      ],
      {
        cwd,
        env: process.env,
        stdio: ["ignore", "pipe", "pipe"]
      }
    );
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", (error) => reject(error));
    child.on("close", (code) => {
      if ((code ?? 0) !== 0) {
        const suffix = stderr.trim() ? `: ${stderr.trim()}` : "";
        reject(new Error(`python app lifecycle executor exited with code ${code ?? 0}${suffix}`));
        return;
      }
      try {
        resolve(JSON.parse(stdout) as ExecutorEnvelope);
      } catch (error) {
        reject(new Error(`invalid lifecycle executor response: ${error instanceof Error ? error.message : String(error)}`));
      }
    });
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
}
