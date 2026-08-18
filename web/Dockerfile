# MindCard Web — Next.js 14 standalone 多阶段构建
# 用法: docker build -t mindcard-web:latest \
#          --build-arg NEXT_PUBLIC_API_URL=https://api.mindcard.online .

# ── 构建阶段 ─────────────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /app

# pnpm 9 (lockfile v9)
RUN corepack enable && corepack prepare pnpm@9 --activate

# 国内网络加速：pnpm 使用 npmmirror 镜像源（海外部署可删除此行）
RUN pnpm config set registry https://registry.npmmirror.com

# 先复制依赖清单，利用层缓存加速重复构建
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# 复制源码并构建
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# NEXT_PUBLIC_* 在构建时内联，运行时无法覆盖
ARG NEXT_PUBLIC_API_URL=https://api.mindcard.online
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
RUN pnpm build

# ── 运行时阶段 ───────────────────────────────────────────
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# 非 root 运行（容器安全基线）
RUN addgroup --system --gid 1001 nodejs \
    && adduser --system --uid 1001 nextjs

# standalone 输出：server.js + 裁剪后的 node_modules
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
# 静态资源与 public 不包含在 standalone 内，需单独复制
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]
