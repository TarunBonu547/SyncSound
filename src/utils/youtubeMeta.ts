import type { Track } from '../types/music';

/**
 * Metadata of a YouTube video.
 *
 * The lookup uses noembed, the same public service the room already uses for
 * the title of a track. It never throws here: a track that cannot be looked
 * up still enters the queue, with the video id as its title.
 */
export type VideoMeta = {
  title: string;
  channel: string;
  thumbnail: string;
  duration: number;
};

/** The artwork of a video, even when the lookup fails. */
export function thumbnailFor(id: string) {
  return `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
}

/** The metadata of a video, with a usable fallback. Never throws. */
export async function fetchVideoMeta(id: string): Promise<VideoMeta> {
  const fallback: VideoMeta = { title: id, channel: '', thumbnail: thumbnailFor(id), duration: 0 };
  try {
    const res = await fetch(`https://noembed.com/embed?url=https://www.youtube.com/watch?v=${id}`);
    if (!res.ok) return fallback;
    const data = await res.json();
    return {
      title: data?.title || id,
      channel: data?.author_name || '',
      thumbnail: data?.thumbnail_url || fallback.thumbnail,
      duration: 0,
    };
  } catch {
    return fallback;
  }
}

/**
 * The metadata of a video for the search. Unlike `fetchVideoMeta` this one
 * reports a failure, so the search can show an error instead of a placeholder.
 */
export async function lookupVideo(id: string): Promise<Track> {
  const res = await fetch(`https://noembed.com/embed?url=https://www.youtube.com/watch?v=${id}`);
  if (!res.ok) throw new Error('The video could not be looked up.');
  const data = await res.json();
  if (!data || data.error || !data.title) throw new Error(data?.error || 'No video was found for that link.');
  return {
    id,
    title: String(data.title),
    channel: String(data.author_name || 'Unknown channel'),
    thumbnail: String(data.thumbnail_url || thumbnailFor(id)),
  };
}
