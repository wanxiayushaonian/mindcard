#!/usr/bin/env bash
# MindCard 服务器初始化脚本（Ubuntu/Debian）
# 用法: sudo bash deploy/setup-server.sh
# 作用: 安装 docker/nginx/certbot，配置镜像加速，预拉基础镜像，放行端口
set -euo pipefail

echo "==> [1/4] 安装 docker / nginx / certbot ..."
apt-get update
apt-get install -y docker.io docker-compose-v2 nginx certbot python3-certbot-nginx

echo "==> [2/4] 配置 Docker 国内镜像加速 ..."
mkdir -p /etc/docker
cat > /etc/docker/daemon.json <<'EOF'
{
  "registry-mirrors": [
    "https://docker.m.daocloud.io",
    "https://docker.1ms.run",
    "https://docker.xuanyuan.me"
  ]
}
EOF
systemctl restart docker
systemctl enable --now docker nginx

echo "==> [3/4] 预拉基础镜像（避开 Docker Hub 慢速直连）..."
docker pull docker.m.daocloud.io/library/node:20-alpine
docker tag  docker.m.daocloud.io/library/node:20-alpine node:20-alpine

echo "==> [4/4] 初始化完成。"
cat <<'MSG'
─────────────────────────────────────────────────────────
  接下来请手动完成：
  1) DNS：将 mindcard.online 与 api.mindcard.online
     的 A 记录指向本机公网 IP
  2) 云控制台安全组放行 80 / 443（如需 SSH 管理保留 22）
  3) 复制生产环境变量模板：
       cp deploy/env.prod.example server/.env
       并填写真实密钥（POSTGRES_PASSWORD / JWT_SECRET /
       ADMIN_USERNAMES / LLM keys / EMBEDDING_*）
  4) 按 deploy/README.md 完成构建与部署
─────────────────────────────────────────────────────────
MSG
