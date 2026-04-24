interface AssetsBinding {
  fetch: (request: Request) => Promise<Response>;
}

interface Env {
  ASSETS: AssetsBinding;
}

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/docs") {
      url.pathname = "/docs/";
      return Response.redirect(url.toString(), 301);
    }

    const rewrittenPath = url.pathname.replace(/^\/docs(?=\/|$)/, "") || "/";

    url.pathname = rewrittenPath;

    return env.ASSETS.fetch(new Request(url.toString(), request));
  },
};
