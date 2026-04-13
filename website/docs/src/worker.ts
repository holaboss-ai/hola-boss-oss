interface AssetsBinding {
  fetch: (request: Request) => Promise<Response>;
}

interface Env {
  ASSETS: AssetsBinding;
}

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const rewrittenPath = url.pathname.replace(/^\/docs(?=\/|$)/, "") || "/";

    url.pathname = rewrittenPath;

    return env.ASSETS.fetch(new Request(url.toString(), request));
  },
};
