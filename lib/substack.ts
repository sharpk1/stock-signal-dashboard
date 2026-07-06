import { RssVideo } from '@/lib/youtube';

export interface SubstackPost extends RssVideo {
  bodyHtml: string;
}

export function extractSubstackContent(bodyHtml: string): {
  youtubeVideoId: string | null;
  articleText: string;
} {
  const videoMatch = bodyHtml.match(/&quot;videoId&quot;:&quot;([^&"]+)&quot;/);
  const youtubeVideoId = videoMatch ? videoMatch[1] : null;
  const articleText = bodyHtml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  return { youtubeVideoId, articleText };
}

export async function fetchSubstackPosts(handle: string): Promise<SubstackPost[]> {
  const cookie = process.env.SUBSTACK_SESSION_COOKIE;
  if (!cookie) throw new Error('SUBSTACK_SESSION_COOKIE is not set');

  const url = `https://${handle}.substack.com/api/v1/posts?limit=12`;
  const res = await fetch(url, {
    headers: { Cookie: `substack.sid=${cookie}` },
  });

  if (!res.ok) throw new Error(`Substack API failed for ${handle}: ${res.status}`);

  const posts = (await res.json()) as Array<{
    slug: string;
    title: string;
    post_date: string;
    body_html: string;
  }>;

  const cutoff = Date.now() - 3 * 24 * 60 * 60 * 1000;

  return posts
    .filter(p => new Date(p.post_date).getTime() >= cutoff)
    .map(p => ({
      videoId: p.slug,
      title: p.title,
      publishedAt: p.post_date,
      bodyHtml: p.body_html ?? '',
    }));
}
