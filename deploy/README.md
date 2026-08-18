# MindCard 生产部署手册

部署目标：`mindcard.online`（单域，前端 + `/api` 同域转发）→ 美国服务器 `64.83.21.83`

```
                        公网 80/443
                            │  Caddy (宿主机, 自动 HTTPS)
              ┌─────────────┴─────────────┐
mindcard.online ─▶  web 容器 :3000   /api/* + /ws ─▶ server 容器 :8000
                                                            │
                                               /api/ws WebSocket upgrade
                               Docker: mindcard-app + mindcard-postgres + mindcard-redis
```

> 前端构建参数 `NEXT_PUBLIC_API_URL` 必须用 `https://mindcard.online`（**同域**，Caddy 路径
> 转发 `/api/*` → 后端）。不要用独立的 `api.` 子域——Caddy 未配置该域名，且需额外 DNS 记录。

---

## 0. 前置条件

| 项 | 要求 |
|----|------|
| DNS | `mindcard.online` A → `64.83.21.83`（单条即可，无需 `api.` 子域） |
| 服务器 | Docker（含 compose）、Caddy；防火墙放行 80/443 |
| 资源 | 2 核 4G 起步（无 Ollama 时可跑）；数据库在容器内 |

```bash
# 服务器上一次性准备
# 方式 A：一键脚本（推荐，含镜像加速与基础镜像预拉）
sudo bash deploy/setup-server.sh
# 方式 B：手动
# sudo apt update
# sudo apt install -y docker.io docker-compose-v2 nginx certbot python3-certbot-nginx
# sudo systemctl enable --now docker nginx
```

### 网络加速（国内服务器必做）

国内访问 Docker Hub / npm 官方源极慢（实测基础镜像下载仅 ~8KB/s），构建会卡死。三项加速：

```bash
# 1) Docker 镜像加速：写入 daemon.json 后重启 docker
sudo mkdir -p /etc/docker
sudo tee /etc/docker/daemon.json >/dev/null <<'EOF'
{
  "registry-mirrors": [
    "https://docker.m.daocloud.io",
    "https://docker.1ms.run",
    "https://docker.xuanyuan.me"
  ]
}
EOF
sudo systemctl restart docker

# 2) 预拉基础镜像并 retag（buildkit 的 FROM 才会命中本地，不触慢速网络）
docker pull docker.m.daocloud.io/library/node:20-alpine
docker tag  docker.m.daocloud.io/library/node:20-alpine node:20-alpine

# 3) pnpm 镜像源已内置在 web/Dockerfile（registry.npmmirror.com），无需额外操作
```

---

## 1. 准备 `server/.env`

```bash
cd server
cp ../deploy/env.prod.example .env   # 生产模板（含全部变量说明）
chmod 600 .env
```

按需编辑（**生产必须修改**的项）：

```ini
# ── 数据库（compose 变量插值源，务必更换为强随机密码）──
POSTGRES_USER=mindcard
POSTGRES_PASSWORD=REPLACE_WITH_A_STRONG_RANDOM_PASSWORD
POSTGRES_DB=mindcard

# ── 安全 ──
JWT_SECRET=REPLACE_WITH_32+_CHAR_RANDOM
ADMIN_USERNAMES=你的注册用户名        # 服务器级设置白名单；留空则全部 403
CORS_ORIGINS=https://mindcard.online  # 生产收紧，勿用 *

# ── LLM（至少配置一个 provider）──
DEFAULT_LLM_PROVIDER=claude
ANTHROPIC_API_KEY=sk-ant-...
# 或 DEEPSEEK_API_KEY=... / OPENAI_API_KEY=...

# ── Embedding：选一 ──
# A) 远程 API（推荐，无需跑 Ollama）
EMBEDDING_PROVIDER=openai
EMBEDDING_BASE_URL=https://api.siliconflow.cn/v1
EMBEDDING_API_KEY=sk-...
EMBEDDING_MODEL=BAAI/bge-m3
# B) 本地 Ollama
# EMBEDDING_PROVIDER=ollama
# OLLAMA_BASE_URL=http://<ollama-host>:11434
```

> ⚠️ 旧密码 `1rU0Z3FfUSRxa8vOFU6S` 已在 git 历史中泄漏，**不要复用**。
> 若仓库将公开，用 `git filter-repo` 清理：`git filter-repo --replace-text <(echo '1rU0Z3FfUSRxa8vOFU6S==>REDACTED')`

---

## 2. 构建并启动后端

```bash
cd server
# 构建镜像（不含 torch，体积小）
docker build -t mindcard-app:latest .

# 先只启动数据库，等待 healthy
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d postgres
docker compose -f docker-compose.yml -f docker-compose.prod.yml ps  # 等 postgres healthy

# 执行数据库迁移（一次性容器）
docker compose -f docker-compose.yml -f docker-compose.prod.yml run --rm app alembic upgrade head

# 启动 API（nginx 代理 127.0.0.1:8000）
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d app
curl http://127.0.0.1:8000/health   # 期望 {"status":"ok"}
```

---

## 3. 构建并启动前端

```bash
cd web
docker build \
  --build-arg NEXT_PUBLIC_API_URL=https://mindcard.online \
  -t mindcard-web:latest .

docker run -d --name mindcard-web \
  --restart unless-stopped \
  -p 3000:3000 \
  mindcard-web:latest
```

验证：`curl http://127.0.0.1:3000` 应返回 HTML。

> `NEXT_PUBLIC_API_URL` 在构建时内联进 JS，改地址必须重新构建镜像。
> 必须用同域 `https://mindcard.online`（Caddy 路径转发 `/api/*` → 后端）。

---

## 4. Caddy + HTTPS（当前架构）

```bash
# Caddy 单域配置：mindcard.online → web:3000，/api/* + /ws → server:8000
cat > /etc/caddy/Caddyfile <<'EOF'
mindcard.online {
    reverse_proxy localhost:3000
    reverse_proxy /api/* localhost:8000
    reverse_proxy /ws localhost:8000
}
EOF
systemctl reload caddy   # 自动申请/续期 TLS 证书
```

WebSocket 已通过 `Upgrade`/`Connection` 头透传，无需额外配置。

---

## 5. 验证清单

```bash
curl -I https://mindcard.online                     # 前端 200
curl https://mindcard.online/health                 # {"status":"ok"}（经 Caddy 转发到后端）
curl https://mindcard.online/api/auth/login -X POST \
  -H 'Content-Type: application/json' \
  -d '{"username":"x","password":"x"}'              # 登录接口可达（422 = 到达后端）
# WebSocket 冒烟（可选）：浏览器控制台 new WebSocket("wss://mindcard.online/api/ws?token=<JWT>")
```

浏览器端验证：注册 → 建空间 → 建卡片（触发 embedding）→ 搜索/RAG 对话（验证 LLM + WebSocket 流式）。

---

## 6. 日常更新

```bash
cd server && docker build -t mindcard-app:latest . \
  && docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d
cd web && docker build --build-arg NEXT_PUBLIC_API_URL=https://mindcard.online -t mindcard-web:latest . \
  && docker rm -f mindcard-web && docker run -d --name mindcard-web --restart unless-stopped -p 3000:3000 mindcard-web:latest
```

---

## 故障排查

| 症状 | 排查 |
|------|------|
| `POSTGRES_PASSWORD` 报错退出 | compose 变量缺失 → 在 `server/.env` 设置 `POSTGRES_PASSWORD` 后重启 |
| 卡片创建后搜不到 | embedding 失败（后台任务日志）→ 检查 `EMBEDDING_*` 配置 / Ollama 连通性 |
| 聊天无响应 | `docker compose logs -f app` 看 LLM provider 报错（API key / 429 限流） |
| 前端 502 | web 容器未启动 / 端口不符（3000） |
| 设置页 403 | `ADMIN_USERNAMES` 未包含当前登录用户名 |

---

## 附：目录与产物

| 路径 | 说明 |
|------|------|
| `web/Dockerfile` | Next.js standalone 多阶段构建（构建期注入 `NEXT_PUBLIC_API_URL`） |
| `web/.dockerignore` | 构建上下文排除（node_modules/.next/.env.local 等） |
| `deploy/nginx/mindcard.conf` | 反代 + WebSocket 配置（HTTP 入口，certbot 注入 TLS） |
| `server/docker-compose*.yml` | 后端编排（DB/Redis/API；密码由 `POSTGRES_PASSWORD` 变量注入） |
