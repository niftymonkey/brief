# YouTube Data API v3: facts that shaped the Topic design

Verified against the official docs on 2026-09-08. Re-check the revision history before leaning on any of these:
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
