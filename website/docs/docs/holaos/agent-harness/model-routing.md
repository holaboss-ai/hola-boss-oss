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

The runtime chooses this model path before invoking the harness, then passes the prepared client payload into the host request.

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

## Routing responsibility

This is one of the places where `holaOS` keeps responsibility in the environment layer:

- runtime resolves provider and model selection
- runtime normalizes the provider kind and model-proxy path
- harness executes the prepared run against that resolved model client

That keeps execution consistent across harnesses instead of duplicating provider logic in each executor.
