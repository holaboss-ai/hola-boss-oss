import http from 'node:http';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { createOpencode } from '@opencode-ai/sdk';

process.env.PATH = `${process.cwd()}/node_modules/.bin:${process.env.PATH}`;

function startMockModelServer() {
  const requests = [];
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const bodyText = Buffer.concat(chunks).toString('utf8');
    let body = null;
    try {
      body = bodyText ? JSON.parse(bodyText) : null;
    } catch {
      body = null;
    }
    requests.push({ method: req.method, url: req.url, body });
    console.error('[mock]', req.method, req.url, JSON.stringify({ model: body?.model ?? null, stream: body?.stream ?? null }));

    if (req.method === 'GET' && req.url === '/v1/models') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ object: 'list', data: [{ id: 'test-model', object: 'model' }] }));
      return;
    }

    if (req.method === 'POST' && (req.url === '/v1/chat/completions' || req.url === '/chat/completions')) {
      const stream = Boolean(body?.stream);
      const text = 'LIVE_SMOKE_OK';
      if (stream) {
        res.writeHead(200, {
          'content-type': 'text/event-stream',
          'cache-control': 'no-cache',
          connection: 'keep-alive',
        });
        const created = Math.floor(Date.now() / 1000);
        const id = 'chatcmpl-smoke';
        const model = body?.model || 'test-model';
        const payloads = [
          { id, object: 'chat.completion.chunk', created, model, choices: [{ index: 0, delta: { role: 'assistant' }, finish_reason: null }] },
          { id, object: 'chat.completion.chunk', created, model, choices: [{ index: 0, delta: { content: text }, finish_reason: null }] },
          { id, object: 'chat.completion.chunk', created, model, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] },
        ];
        for (const item of payloads) {
          res.write(`data: ${JSON.stringify(item)}\n\n`);
        }
        res.write('data: [DONE]\n\n');
        res.end();
        return;
      }

      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        id: 'chatcmpl-smoke',
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model: body?.model || 'test-model',
        choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }));
      return;
    }

    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: { message: `Unhandled ${req.method} ${req.url}` } }));
  });
  server.listen(0, '127.0.0.1');
  return { server, requests };
}

const { server: mockServer, requests } = startMockModelServer();
await once(mockServer, 'listening');
const mockPort = mockServer.address().port;
console.error('[diag] mock port', mockPort);

let opencode;
let child;
try {
  opencode = await createOpencode({
    hostname: '127.0.0.1',
    port: 0,
    config: {
      autoupdate: false,
      model: 'local/test-model',
      provider: {
        local: {
          npm: '@ai-sdk/openai-compatible',
          name: 'Mock OpenAI Compatible',
          options: {
            apiKey: 'test-key',
            baseURL: `http://127.0.0.1:${mockPort}/v1`,
          },
          models: {
            'test-model': { name: 'test-model' },
          },
        },
      },
    },
  });
  console.error('[diag] opencode url', opencode.server.url);

  const request = {
    workspace_id: 'workspace-smoke',
    workspace_dir: process.cwd(),
    session_id: 'session-smoke',
    input_id: 'input-smoke',
    instruction: 'Reply with exactly LIVE_SMOKE_OK and nothing else.',
    debug: true,
    harness_session_id: null,
    persisted_harness_session_id: null,
    provider_id: 'local',
    model_id: 'test-model',
    mode: 'code',
    opencode_base_url: opencode.server.url,
    timeout_seconds: 10,
    system_prompt: 'You are a precise test assistant.',
    tools: { read: true, list: true, glob: true, grep: true },
    workspace_tool_ids: [],
    workspace_skill_ids: [],
    mcp_servers: [],
    output_format: null,
    workspace_config_checksum: 'smoke-checksum',
    run_started_payload: {
      instruction_preview: 'Reply with exactly LIVE_SMOKE_OK and nothing else.',
      provider_id: 'local',
      model_id: 'test-model',
      workspace_tool_ids: [],
      workspace_skill_ids: [],
      mcp_server_ids: [],
      mcp_server_mappings: [],
      workspace_mcp_sidecar_reused: false,
      structured_output_enabled: false,
      workspace_config_checksum: 'smoke-checksum',
    },
    model_client: {
      model_proxy_provider: 'openai_compatible',
      api_key: 'test-key',
      base_url: `http://127.0.0.1:${mockPort}/v1`,
      default_headers: null,
    },
  };

  const encoded = Buffer.from(JSON.stringify(request), 'utf8').toString('base64');
  child = spawn(process.execPath, ['dist/index.mjs', 'run-opencode', '--request-base64', encoded], {
    cwd: process.cwd(),
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  child.stdout.on('data', (chunk) => process.stdout.write(`[host-out] ${chunk}`));
  child.stderr.on('data', (chunk) => process.stderr.write(`[host-err] ${chunk}`));

  const [code, signal] = await once(child, 'close');
  console.error('[diag] child close', JSON.stringify({ code, signal, request_count: requests.length }));
} finally {
  if (child && !child.killed) {
    child.kill('SIGTERM');
  }
  if (opencode) {
    opencode.server.close();
  }
  mockServer.close();
}
