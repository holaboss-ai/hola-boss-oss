import { spawn } from "node:child_process";
import type { Readable } from "node:stream";

export type ExecutorEnvelope<TPayload> = {
  status_code: number;
  payload?: TPayload;
  detail?: string | null;
};

function runtimeAppRoot(): string {
  const configured = (process.env.HOLABOSS_RUNTIME_APP_ROOT ?? "").trim();
  return configured || process.cwd();
}

function runtimePythonBin(): string {
  const configured = (process.env.HOLABOSS_RUNTIME_PYTHON ?? "").trim();
  return configured || "python";
}

export async function executePythonJson<TPayload>(params: {
  moduleName: string;
  args?: string[];
  payload?: Record<string, unknown>;
  invalidResponseMessage: string;
  nonZeroExitMessage: string;
}): Promise<ExecutorEnvelope<TPayload>> {
  const cwd = runtimeAppRoot();
  const pythonBin = runtimePythonBin();
  return await new Promise<ExecutorEnvelope<TPayload>>((resolve, reject) => {
    const child = spawn(
      pythonBin,
      ["-m", params.moduleName, ...(params.args ?? [])],
      {
        cwd,
        env: process.env,
        stdio: ["pipe", "pipe", "pipe"]
      }
    );
    let stdout = "";
    let stderr = "";
    child.stdin.end(JSON.stringify(params.payload ?? {}));
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
        reject(new Error(`${params.nonZeroExitMessage} ${code ?? 0}${suffix}`));
        return;
      }
      try {
        resolve(JSON.parse(stdout) as ExecutorEnvelope<TPayload>);
      } catch (error) {
        reject(new Error(`${params.invalidResponseMessage}: ${error instanceof Error ? error.message : String(error)}`));
      }
    });
  });
}

export async function executePythonStream(params: {
  moduleName: string;
  args?: string[];
  payload?: Record<string, unknown>;
  nonZeroExitMessage: string;
}): Promise<Readable> {
  const cwd = runtimeAppRoot();
  const pythonBin = runtimePythonBin();
  const child = spawn(
    pythonBin,
    ["-m", params.moduleName, ...(params.args ?? [])],
    {
      cwd,
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"]
    }
  );
  child.stdin.end(JSON.stringify(params.payload ?? {}));
  const stderrChunks: string[] = [];
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => {
    stderrChunks.push(chunk);
  });
  child.on("close", (code) => {
    if ((code ?? 0) !== 0) {
      const suffix = stderrChunks.join("").trim();
      const message = suffix ? `${params.nonZeroExitMessage} ${code ?? 0}: ${suffix}` : `${params.nonZeroExitMessage} ${code ?? 0}`;
      child.stdout.destroy(new Error(message));
    }
  });
  return child.stdout;
}
