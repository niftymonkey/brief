# Web Application Documentation

Full-featured web app with user accounts and saved briefs.

## Quick Start

```bash
pnpm install
pnpm dev
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `ANTHROPIC_API_KEY` | For AI-powered summarization |
| `YOUTUBE_API_KEY` | For fetching video metadata |
| `DATABASE_URL` | PostgreSQL connection string |
| `WORKOS_API_KEY` | WorkOS API key |
| `WORKOS_CLIENT_ID` | WorkOS client ID |
| `WORKOS_COOKIE_PASSWORD` | 32+ character secret for session encryption |
| `NEXT_PUBLIC_WORKOS_REDIRECT_URI` | OAuth callback URL (e.g., `http://localhost:3000/callback`) |
| `SUPADATA_API_KEY` | For transcript fetching in cloud deployments (optional locally) |

### Local Development

```bash
ANTHROPIC_API_KEY=sk-ant-...
YOUTUBE_API_KEY=AIza...
DATABASE_URL=postgresql://user:password@localhost:5432/youtube_digest
WORKOS_API_KEY=sk_test_...
WORKOS_CLIENT_ID=client_...
WORKOS_COOKIE_PASSWORD=your-32-character-secret-here...
NEXT_PUBLIC_WORKOS_REDIRECT_URI=http://localhost:3000/callback
# SUPADATA_API_KEY not needed - uses youtube-transcript-plus locally
```

### Cloud Deployment

```bash
# Same as above, plus:
SUPADATA_API_KEY=sd_...  # Required - YouTube blocks direct requests from cloud IPs
```

## Transcript Fetching

The app uses different transcript sources based on environment:

- **Local** (no `SUPADATA_API_KEY`): Uses [`youtube-transcript-plus`](https://www.npmjs.com/package/youtube-transcript-plus) - free, no API key needed
- **Cloud** (with `SUPADATA_API_KEY`): Uses [Supadata API](https://supadata.ai/) - required because YouTube blocks direct requests from cloud IPs

## Features

- **User Accounts** - Save and organize your briefs
- **Brief Caching** - Re-generating a brief for the same video is instant
- **Clickable Timestamps** - Jump to any point in the video on YouTube
- **Regenerate** - Re-process any brief with updated AI

## Database Setup

The app uses PostgreSQL. For local development, you can use a local PostgreSQL instance or a service like [Neon](https://neon.tech/) or [Supabase](https://supabase.com/).
