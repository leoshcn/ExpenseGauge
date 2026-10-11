# Interation
- 使用中文和用户进行交流

# Deployment
- 部署机：`192.168.2.144`，用户 `root`，已添加公钥，免密 SSH 登录
- 本机是 Windows，shell 里没有 `ssh`/`scp`，用 `C:/Windows/System32/OpenSSH/ssh.exe` 和 `scp.exe`
- 部署目录 `/opt/expense-gauge`（不是 git 仓库），用 docker compose 运行（db / api / web）
- 部署步骤：
  1. 本地提交后 `git archive --format=tar.gz -o ../eg-deploy-<commit>.tar.gz HEAD`，用 scp 上传到 `/opt/expense-gauge/`
  2. 先备份数据库：`docker compose exec -T db pg_dump -U <user> -d <db> --clean --if-exists > backups/expense-gauge-pre<迁移号>-<时间>.sql`（用户名、库名见 `.env`）
  3. 把 `backend frontend docs docker-compose.yml README.md` 复制到 `previous/<时间>/`，删掉旧的 `backend frontend docs` 后解压新包
  4. `docker compose up -d --build`，api 启动时自动执行迁移
  5. 检查 `docker compose ps` 是否都 healthy，以及 `alembic_version` 是否升到了目标版本
- 迁移只能往前走：回退要用 `previous/` 里的源码重新构建，再用备份恢复数据库