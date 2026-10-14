# YouTube: verified facts that shaped Topics and Collections

The Data API facts were verified against the official docs on 2026-09-08; the frame-shape, thumbnail and embed facts on 2026-07-29 and 2026-10-14. Re-check the revision history before leaning on any of these:
https://developers.google.com/youtube/v3/revision_history

## Quota

- `search.list` has its own bucket: **100 calls per day**, cost 1 each. It does not draw on the 10,000-unit daily quota.
- `videos.list` costs 1 unit and accepts up to 50 video IDs per call.
- `playlistItems.list` costs 1 unit. `commentThreads.list` costs 1 unit.

## search.list

- Supports `q`, `publishedAfter`, `publishedBefore`, `order=viewCount|date|relevance|rating|title`, `type=video`, `videoCaption=closedCaption`, `videoDuration`, `regionCode`, `relevanceLanguage`, `channelId`, `safeSearch`, `maxResults` (max 50), and `topicId`.
- Does **not** return view counts. Get them from `videos.list?part=statistics`.
- `relatedToVideoId` was removed on 2023-08-07. There is no related-videos call.
- `topicId` is a small curated set. Useful ones: `/m/07c1v` Technology, `/m/0kt51` Health, `/m/09s1f` Business, `/m/01k8wb` Knowledge, `/m/0bzvm2` Gaming. **There is no AI topic.**

## What the API cannot give

- Nothing returns the signed-in user's home feed or recommendations.
- Watch history is not available.
- `chart=mostPopular` takes only `regionCode` and `videoCategoryId`. It cannot follow a query or a topic. The nearest equivalent is `search.list` with `order=viewCount` plus `publishedAfter`.

## What it can give about a user

- `subscriptions.list?mine=true` with OAuth lists the channels the signed-in user subscribes to.
- Without OAuth, Google Takeout exports the same list as `Takeout/YouTube and YouTube Music/subscriptions/subscriptions.csv` (columns: Channel Id, Channel Url, Channel Title). Subscriptions may live on a Brand Account, which Takeout treats as a separate user.

## Captions

- Do not filter search by `videoCaption=closedCaption`. Read `contentDetails.caption` from the `videos.list` batch instead, so a Report can say how many candidates had no captions. Whether that field is trustworthy for auto-generated captions is unverified.

## Frame shape (aspect ratio)

- `videos.list` with `part` including `player` and `maxWidth: 8192` returns `player.embedWidth` and `player.embedHeight` **as JSON strings**. Only their ratio is stable; the pixel values scale to `maxWidth`. It rides free on a lookup already being made, since `videos.list` costs 1 unit regardless of parts.
- Dead ends, all verified: `snippet.thumbnails` sizes (identical for both shapes), oEmbed (no aspect data), `contentDetails.dimension` and `.projection` (stereoscopy and 360, not frame shape), `fileDetails` (owner-only OAuth), duration heuristics (false positives), a pasted `/shorts/` URL (discarded by the parser), the IFrame API (no aspect getter, and the `<video>` is cross-origin).

## Thumbnails

- Vertical videos use `https://i.ytimg.com/vi/<id>/frame0.jpg` with `mqdefault.jpg` as fallback, because `mqdefault` has pillarbox panels baked into the pixels. These ytimg paths are undocumented. `oar2.jpg` is clean but 404s on at least one real video (`A0scuiiGBC4`); `oardefault.jpg` 404s everywhere. `frame0.jpg` is low resolution at large sizes.

## Embedded Shorts

- YouTube serves some visitors a "Shorts embed" player for Shorts (`<shorts-embeds>`, `ytm-reel-player-overlay-renderer` inside the iframe). It has no fullscreen button, ignores the documented `fs` default, and no player parameter opts out. Which player a visitor gets follows YouTube's own cookies (`VISITOR_INFO1_LIVE`, `__Secure-ROLLOUT_TOKEN`), not viewport width or user agent, and sticks once assigned. Regular landscape videos always get the standard player. This is why the collection player draws its own full screen toggle.
- `Element.requestFullscreen` is not available on iPhone Safari (iPad only, per MDN browser-compat-data), so the toggle falls back to filling the viewport with CSS there.
