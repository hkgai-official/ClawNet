FROM node:22-bookworm@sha256:cd7bcd2e7a1e6f72052feb023c7f6b722205d3fcab7bbcbd2d1bfdab10b1e935

# 修改 node 用户的 UID/GID 为 1001，匹配宿主机用户
ARG NODE_UID=1001
ARG NODE_GID=1001
RUN groupmod -g ${NODE_GID} node && \
    usermod -u ${NODE_UID} -g ${NODE_GID} node && \
    chown -R node:node /home/node

# Install Bun (required for build scripts)
RUN curl -fsSL https://bun.sh/install | bash
ENV PATH="/root/.bun/bin:${PATH}"

RUN corepack enable

WORKDIR /app
RUN chown node:node /app

ARG OPENCLAW_DOCKER_APT_PACKAGES=""
RUN if [ -n "$OPENCLAW_DOCKER_APT_PACKAGES" ]; then \
      apt-get update && \
      DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends $OPENCLAW_DOCKER_APT_PACKAGES && \
      apt-get clean && \
      rm -rf /var/lib/apt/lists/* /var/cache/apt/archives/*; \
    fi

COPY --chown=node:node package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY --chown=node:node ui/package.json ./ui/package.json
COPY --chown=node:node patches ./patches
COPY --chown=node:node scripts ./scripts

USER node
RUN pnpm install --frozen-lockfile

# Optionally install Chromium and Xvfb for browser automation.
# Build with: docker build --build-arg OPENCLAW_INSTALL_BROWSER=1 ...
# Adds ~300MB but eliminates the 60-90s Playwright install on every container start.
# Must run after pnpm install so playwright-core is available in node_modules.
USER root
ARG OPENCLAW_INSTALL_BROWSER=""
RUN if [ -n "$OPENCLAW_INSTALL_BROWSER" ]; then \
      apt-get update && \
      DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends xvfb && \
      mkdir -p /home/node/.cache/ms-playwright && \
      PLAYWRIGHT_BROWSERS_PATH=/home/node/.cache/ms-playwright \
      node /app/node_modules/playwright-core/cli.js install --with-deps chromium && \
      chown -R node:node /home/node/.cache/ms-playwright && \
      apt-get clean && \
      rm -rf /var/lib/apt/lists/* /var/cache/apt/archives/*; \
    fi

USER node
COPY --chown=node:node . .
RUN pnpm build
# Force pnpm for UI build (Bun may fail on ARM/Synology architectures)
ENV OPENCLAW_PREFER_PNPM=1
RUN pnpm ui:build

ENV NODE_ENV=production

# 预安装 clawhub 包
# clawhub 会将包安装到 /app/skills/ 目录，这是镜像的一部分，不会被 volume 覆盖
ARG OPENCLAW_CLAWHUB_PACKAGES=""
COPY --chown=node:node clawhub-packages.txt* /tmp/
USER node
RUN set -e; \
    PACKAGES="$OPENCLAW_CLAWHUB_PACKAGES"; \
    if [ -f /tmp/clawhub-packages.txt ]; then \
      FILE_PACKAGES=$(grep -v '^#' /tmp/clawhub-packages.txt | grep -v '^[[:space:]]*$' | tr '\n' ' '); \
      PACKAGES="$PACKAGES $FILE_PACKAGES"; \
    fi; \
    if [ -n "$(echo $PACKAGES | tr -d '[:space:]')" ]; then \
      echo "==> 预安装 clawhub 包: $PACKAGES"; \
      for pkg in $PACKAGES; do \
        echo "==> 安装: $pkg"; \
        npx -y clawhub@latest install "$pkg" || echo "警告: 安装 $pkg 失败"; \
      done; \
    else \
      echo "==> 未指定 clawhub 包，跳过安装"; \
    fi

# Security hardening: Run as non-root user
# The node:22-bookworm image includes a 'node' user (uid 1000)
# This reduces the attack surface by preventing container escape via root privileges
USER node

# Start gateway server with default config.
# Binds to loopback (127.0.0.1) by default for security.
#
# For container platforms requiring external health checks:
#   1. Set OPENCLAW_GATEWAY_TOKEN or OPENCLAW_GATEWAY_PASSWORD env var
#   2. Override CMD: ["node","openclaw.mjs","gateway","--allow-unconfigured","--bind","lan"]
CMD ["node", "openclaw.mjs", "gateway", "--allow-unconfigured"]
