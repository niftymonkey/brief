# CLI Documentation

Command-line tool for generating YouTube video briefs.

## Installation

```bash
pnpm install
```

## Configuration

Copy the example environment file and add your API keys:

```bash
cp .env.example .env
```

### Required API Keys

| Variable | Description | Get it at |
|----------|-------------|-----------|
| `ANTHROPIC_API_KEY` | For AI-powered summarization | [console.anthropic.com](https://console.anthropic.com/) |
| `YOUTUBE_API_KEY` | For fetching video metadata | [Google Cloud Console](https://console.cloud.google.com/) (enable YouTube Data API v3) |

## Usage

```bash
pnpm brief <youtube-url>
```

Supports standard, short, and mobile YouTube URLs:
- `https://www.youtube.com/watch?v=VIDEO_ID`
- `https://youtu.be/VIDEO_ID`
- `https://m.youtube.com/watch?v=VIDEO_ID`

## Output

Briefs are saved to `outputs/{channel-slug}/{title-slug}.md`

Each brief includes:
- Video metadata and a 2-3 sentence "At a Glance" summary
- Sections table with clickable timestamps
- Key points for each section (2-4 bullets synthesizing the content)
- Tangents section (if any off-topic segments detected)
- Categorized links from the video description

## Requirements

- Node.js 18+
- Videos must have captions enabled (auto-generated or manual)
