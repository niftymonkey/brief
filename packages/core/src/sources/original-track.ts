import { z } from "zod";

const TracklistSchema = z.looseObject({
  captionTracks: z.array(z.looseObject({ languageCode: z.string() })),
  audioTracks: z
    .array(z.looseObject({ defaultCaptionTrackIndex: z.number().optional() }))
    .optional(),
  defaultAudioTrackIndex: z.number().optional(),
});

const PlayerSchema = z.looseObject({
  captions: z.looseObject({
    playerCaptionsTracklistRenderer: TracklistSchema,
  }),
});

export interface PreferredCaptions {
  player: unknown;
  languages: string[];
}

/**
 * Reorders an Innertube player response so the caption track for the video's
 * original audio comes first. youtube-transcript-plus takes the first track
 * when no language is requested, and on an auto-dubbed video the list also
 * holds one caption track per dubbed audio track, in no stable order. Each
 * audio track names its default caption track, and on dubbed videos that is
 * the original-language one, so the default audio track's pick is used.
 */
export function preferOriginalCaptionTrack(player: unknown): PreferredCaptions {
  const parsed = PlayerSchema.safeParse(player);
  if (!parsed.success) return { player, languages: [] };

  const tracklist = parsed.data.captions.playerCaptionsTracklistRenderer;
  const tracks = tracklist.captionTracks;
  const languages = tracks.map((t) => t.languageCode);

  const audio =
    tracklist.audioTracks?.[tracklist.defaultAudioTrackIndex ?? 0];
  const index = audio?.defaultCaptionTrackIndex;
  const original = index === undefined ? undefined : tracks[index];
  if (!original) return { player, languages };

  return {
    player: {
      ...parsed.data,
      captions: {
        ...parsed.data.captions,
        playerCaptionsTracklistRenderer: {
          ...tracklist,
          captionTracks: [original, ...tracks.filter((t) => t !== original)],
        },
      },
    },
    languages,
  };
}
