# Brief

AI-powered summaries from YouTube videos. BYOK (bring your own API keys).

## Features

- **Structured Summaries** - AI-generated topic sections with timestamp ranges and key takeaways
- **Smart Link Categorization** - Extracts URLs from descriptions and sorts them into "Related" (resources, docs, tools) vs "Other" (social, sponsors)
- **Tangent Detection** - Off-topic segments are separated so you know what's there without cluttering the main content
- **Clickable Timestamps** - Jump directly to any section in the video

## Getting Started

### Web application

Full-featured web app with user accounts and saved briefs.

```bash
pnpm dev
```

[Web App Documentation](docs/WEBAPP.md)

### `brief` CLI

A standalone command-line tool that fetches a YouTube video's transcript to stdout. Useful for shell scripts and AI coding agents that want to "watch" a video by reading its captions. Different scope from the web app — transcripts only, no AI summary.

```bash
brief <url-or-id>
```

[CLI Documentation](docs/CLI.md)

## Requirements

- Node.js 18+
- Anthropic API key (web app)
- YouTube Data API v3 key (web app; optional for the CLI)
- Videos must have captions enabled

## License

MIT
