# NovaDownloader — production image for Railway / Docker
# Ship official bgutil POT server (prebuilt) so YouTube HD works on datacenter IPs.

FROM brainicism/bgutil-ytdlp-pot-provider:2.0.0 AS pot

FROM node:22-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    python3 \
    python3-pip \
    ca-certificates \
    curl \
    libatomic1 \
    libcairo2 \
    libpango-1.0-0 \
    libpangocairo-1.0-0 \
    libjpeg62-turbo \
    libgif7 \
    librsvg2-2 \
  && pip3 install --no-cache-dir --break-system-packages -U \
      "yt-dlp[default]>=2025.5.22" \
      "yt-dlp-ejs" \
      "bgutil-ytdlp-pot-provider==2.0.0" \
  && rm -rf /var/lib/apt/lists/*

# POT HTTP server + matching Node runtime (canvas native bindings)
COPY --from=pot /app /opt/bgutil-ytdlp-pot-provider/server
COPY --from=pot /usr/local /opt/bgutil-node

WORKDIR /app

COPY package.json package-lock.json ./
COPY packages ./packages
RUN npm ci

COPY . .
RUN npm run build

COPY scripts/docker-start.sh /usr/local/bin/nova-start
RUN chmod +x /usr/local/bin/nova-start

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV YT_DLP_PATH=yt-dlp
ENV FFMPEG_PATH=ffmpeg
ENV YT_DLP_POT_BASE_URL=http://127.0.0.1:4416
ENV YT_DLP_POT_NODE=/opt/bgutil-node/bin/node
ENV YT_DLP_EXTRACTOR_ARGS=youtube:player_client=web,mweb,tv
ENV YT_DLP_DOWNLOAD_EXTRACTOR_ARGS=youtube:player_client=web,mweb,tv

EXPOSE 3001
CMD ["nova-start"]
