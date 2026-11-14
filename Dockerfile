# Baghedge API + hedge worker. One instance only: the worker is the single writer per Hedge account.
FROM oven/bun:1.3.11-slim
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production
COPY server ./server
COPY shared ./shared
ENV HOST=0.0.0.0 PORT=3001 BAGHEDGE_DB_PATH=/var/data/baghedge.sqlite
# Render mounts the persistent disk here. If the mounted disk is not writable by "bun", check the Render disk docs before dropping USER.
RUN mkdir -p /var/data && chown bun:bun /var/data
EXPOSE 3001
USER bun
CMD ["bun", "server/index.ts"]
