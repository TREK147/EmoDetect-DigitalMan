# 数据库脚本说明

## 出现 1045 Access denied 时

若后端报错：`Access denied for user 'emo_system'@'localhost' (using password: YES)`，需要先在 MySQL 中创建用户和数据库。

**用 root 账号执行（在项目根目录或 backend 目录下）：**

```bash
mysql -u root -p < backend/sql/init_mysql_user.sql
```

或在 MySQL 客户端中执行 `backend/sql/init_mysql_user.sql` 中的 SQL。

执行后，用户 `emo_system` 的密码将与 `backend/config.py` 中的默认值一致，连接即可正常。

## 建表脚本

- `create_users.sql`：用户表
- `create_emotion_labels.sql`：情绪标签表
- `migration_legacy_to_v2.sql`：旧版人脸情绪表迁移到当前后端兼容结构（含备份与替换）

应用启动时也会通过 `database.py` 自动创建表，无需单独执行上述建表脚本。
