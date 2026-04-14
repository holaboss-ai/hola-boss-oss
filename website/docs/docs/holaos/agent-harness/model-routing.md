# Model Routing

The harness request includes the model path the runtime has already resolved for this execution. The harness does not own model-provider resolution for the whole environment.

## What the request carries

The request also carries the selected provider and model client configuration for the run.

That includes:

- provider id
- model id
- model proxy provider
- API key
- base URL
- default headers where relevant
- requested `thinking_value` for this run when the operator selected a reasoning effort

The runtime chooses this model path before invoking the harness, then passes the prepared client payload into the host request.

## Reasoning effort is adjacent to routing, not part of routing

The current chat path separates two decisions:

- which provider and model client should execute the run
- how much reasoning effort the selected model should use for this run

The runtime owns the first decision. It resolves provider id, model id, transport kind, and auth headers before the harness starts.

The queued input can also carry a `thinking_value`, but that value stays request-scoped. It is not a global runtime default and it is not part of `runtime.default_model`.

That matters because the allowed values are model-specific rather than universal:

- OpenAI shipped models use labels such as `none`, `low`, `medium`, `high`, and `xhigh`
- OpenRouter shipped models use `minimal`, `low`, `medium`, and `high`
- Anthropic shipped models can use adaptive labels or numeric budgets depending on the model
- Gemini shipped models use numeric budgets, including sentinel values such as `0` or `-1`

The host then normalizes those values onto executor-native reasoning controls. In the current `pi` path, generic OpenAI-compatible routes can also preserve provider-native labels when the underlying client expects them.

## Currently supported providers

The current desktop and runtime path support these provider ids:

- `holaboss_model_proxy` for Holaboss Proxy
- `openai_direct`
- `anthropic_direct`
- `openrouter_direct`
- `gemini_direct`
- `ollama_direct`
- `minimax_direct`

In user-facing terms, the currently supported providers are:

- Holaboss Proxy
- OpenAI
- Anthropic
- OpenRouter
- Gemini
- Ollama
- MiniMax

## Runtime kinds behind those providers

The runtime currently normalizes those providers into these provider kinds:

- `holaboss_proxy`
- `openai_compatible`
- `anthropic_native`
- `openrouter`

Most direct providers in the current product surface use the `openai_compatible` path.

## Model-proxy transport behind the provider kind

The provider kind is not the whole routing story. The runtime also resolves a model-proxy transport path for the actual request:

- `openai_compatible`
- `anthropic_native`
- `google_compatible`

`gemini_direct` is the important special case here. It is configured as an OpenAI-compatible direct provider in the desktop UI, but the runtime resolves it onto the `google_compatible` transport path before the host executes the run.