# WatchParty Server

WebSocket server for WatchParty — a watch-together app for Stremio.

Originally created by [tymmesyde](https://github.com/tymmesyde). Modernized and maintained by MertD95.

## Quick Start

```bash
npm install
npm start
```

The server starts on `ws://localhost:8181` by default. No certificates needed.

## Development

```bash
npm run serve       # Auto-rebuild on file changes
npm test            # Run all tests
npm run test:watch  # Run tests in watch mode
```

Open `tools/manual-client.html` in a browser to manually test the server.

## Configuration

Copy `.env.example` to `.env` and adjust as needed. All values have sensible defaults:

```
PORT=8181
INTERVAL_ROOM_UPDATE=30000
PING_INTERVAL=30000
MAX_CONNECTIONS=10000
MAX_CONNECTIONS_PER_IP=10
LOG_LEVEL=info
NODE_ENV=development
```

For HTTPS/WSS (optional — only needed if not behind a reverse proxy):
```
PEM_CERT=cert/localhost.crt
PEM_KEY=cert/localhost.key
```

