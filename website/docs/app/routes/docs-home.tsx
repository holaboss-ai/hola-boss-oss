import type { Route } from './+types/docs-home';
import { HomeLayout } from 'fumadocs-ui/layouts/home';
import { source } from '@/lib/source';
import browserCollections from 'collections/browser';
import { baseOptions } from '@/lib/layout.shared';
import { useMDXComponents } from '@/components/mdx';

export async function loader() {
  const page = source.getPage([]);
  if (!page) throw new Response('Not found', { status: 404 });
  return { path: page.path };
}

const clientLoader = browserCollections.docs.createClientLoader({
  component(
    { frontmatter, default: Mdx },
    _props: Record<string, never>,
  ) {
    const mdxComponents = useMDXComponents();
    return (
      <>
        <title>{frontmatter.title}</title>
        <meta name="description" content={frontmatter.description} />
        <Mdx components={mdxComponents} />
      </>
    );
  },
});

export default function Page({ loaderData }: Route.ComponentProps) {
  const { path } = loaderData;
  return (
    <HomeLayout {...baseOptions()}>
      <main className="mx-auto w-full max-w-[1280px] px-6 pb-24 md:px-10">
        {clientLoader.useContent(path, {})}
      </main>
    </HomeLayout>
  );
}
