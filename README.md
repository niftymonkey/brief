# YouTube Digest

AI-powered summaries from YouTube videos. Available as a CLI tool or web application. BYOK (bring your own API keys).

## Features

- **Structured Summaries** - AI-generated topic sections with timestamp ranges and key takeaways
- **Smart Link Categorization** - Extracts URLs from descriptions and sorts them into "Related" (resources, docs, tools) vs "Other" (social, sponsors)
- **Tangent Detection** - Off-topic segments are separated so you know what's there without cluttering the main content
- **Clickable Timestamps** - Jump directly to any section in the video

## Getting Started

### CLI

Quick command-line tool for generating digests from any YouTube video. The CLI was the original proof-of-concept for this project and may lag behind the web app in shared functionality.

```bash
pnpm digest <youtube-url>
```

[CLI Documentation](docs/CLI.md)

### Web Application

Full-featured web app with user accounts and saved digests.

```bash
pnpm dev
```

[Web App Documentation](docs/WEBAPP.md)

## Requirements

- Node.js 18+
- Anthropic API key
- YouTube Data API v3 key
- Videos must have captions enabled

## License

MIT
