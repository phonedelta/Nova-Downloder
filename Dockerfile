# NovaDownloader — production image for Railway / Docker
# Multi-stage: build bgutil POT server (needed for HD YouTube formats)

FROM node:22-bookworm-slim AS pot-build
RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    python3 \
    make \
    g++ \
    pkg-config \
    libcairo2-dev \
    libpango1.0-dev \
    libjpeg-dev \
    libgif-dev \
    librsvg2-dev \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /pot
RUN git clone --depth 1 --branch 2.0.0 \
      https://github.com/Brainicism/bgutil-ytdlp-pot-provider.git . \
  && cd server \
  && npm ci \
  && npx tsc \
  && npm prune --omit=dev

FROM node:22-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    python3 \
    python3-pip \
    ca-certificates \
    curl \
    libcairo2 \
    libpango-1.0-0 \
    libpangocairo-1.0-0 \
    libjpeg62-turbo \
    libgif7 \
    librsvg2-2 \
  && pip3 install --no-cache-dir --break-system-packages -U \
      "yt-dlp>=2025.5.22" \
      "bgutil-ytdlp-pot-provider==2.0.0" \
  && rm -rf /var/lib/apt/lists/*

# PO Token HTTP server — without it YouTube often returns only 360p
COPY --from=pot-build /pot/server /opt/bgutil-ytdlp-pot-provider/server

WORKDIR /app

COPY package.json package-lock.json ./
COPY packages ./packages
RUN npm ci

COPY . .
RUN npm run build

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV YT_DLP_PATH=yt-dlp
ENV FFMPEG_PATH=ffmpeg
ENV YT_DLP_POT_BASE_URL=http://127.0.0.1:4416
ENV YT_DLP_EXTRACTOR_ARGS=youtube:player_client=mweb,tv,android,ios
ENV YT_DLP_DOWNLOAD_EXTRACTOR_ARGS=youtube:player_client=mweb,tv
# Railway injects PORT

EXPOSE 3001
CMD ["npm", "start"]
