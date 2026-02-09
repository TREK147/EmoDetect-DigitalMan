"""
MySQL 连接与 users 表管理。
"""
import pymysql
from pymysql.cursors import DictCursor
from typing import Optional

from config import (
    MYSQL_HOST,
    MYSQL_PORT,
    MYSQL_DATABASE,
    MYSQL_USER,
    MYSQL_PASSWORD,
)


def get_connection():
    """获取 MySQL 连接。"""
    return pymysql.connect(
        host=MYSQL_HOST,
        port=MYSQL_PORT,
        user=MYSQL_USER,
        password=MYSQL_PASSWORD,
        database=MYSQL_DATABASE,
        charset="utf8mb4",
        cursorclass=DictCursor,
    )


def create_users_table():
    """创建 users 表（若不存在）。"""
    sql = """
    CREATE TABLE IF NOT EXISTS users (
      id            INT          NOT NULL AUTO_INCREMENT PRIMARY KEY COMMENT '主键',
      mail          VARCHAR(255) NOT NULL COMMENT '邮箱',
      username      VARCHAR(100) NOT NULL COMMENT '用户名',
      password_hash VARCHAR(255) NOT NULL COMMENT '密码哈希（加密存储）',
      created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
      UNIQUE KEY uk_mail (mail),
      KEY idx_username (username)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='用户表'
    """
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(sql)
        conn.commit()


def get_user_by_mail(mail: str) -> Optional[dict]:
    """按邮箱查询用户。"""
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT id, mail, username, password_hash FROM users WHERE mail = %s",
                (mail.strip().lower(),),
            )
            return cur.fetchone()


def get_user_by_id(user_id: int) -> Optional[dict]:
    """按 id 查询用户（不含密码）。"""
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT id, mail, username FROM users WHERE id = %s",
                (user_id,),
            )
            return cur.fetchone()


def create_user(mail: str, username: str, password_hash: str) -> int:
    """插入用户，返回 id。"""
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO users (mail, username, password_hash) VALUES (%s, %s, %s)",
                (mail.strip().lower(), username.strip(), password_hash),
            )
            conn.commit()
            return cur.lastrowid


def create_emotion_labels_table():
    """创建 emotion_labels 表（若不存在），与 users.id 对应。"""
    sql = """
    CREATE TABLE IF NOT EXISTS emotion_labels (
      id            INT          NOT NULL AUTO_INCREMENT PRIMARY KEY COMMENT '主键',
      user_id       INT          NOT NULL COMMENT '用户 id，对应 users.id',
      emotion_label VARCHAR(64)  NOT NULL COMMENT '情绪标签',
      created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '记录时间',
      KEY idx_user_id (user_id),
      KEY idx_user_created (user_id, created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='用户情绪标签表'
    """
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(sql)
        conn.commit()


def add_emotion_label(user_id: int, emotion_label: str) -> int:
    """为该 user_id 添加一条情绪标签记录，返回本条记录 id。"""
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO emotion_labels (user_id, emotion_label) VALUES (%s, %s)",
                (user_id, (emotion_label or "").strip()),
            )
            conn.commit()
            return cur.lastrowid


def get_emotion_labels_by_user(user_id: int, limit: int = 100) -> list:
    """按 user_id 查询该用户的情绪标签列表，按时间倒序。"""
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """SELECT id, user_id, emotion_label, created_at
                   FROM emotion_labels WHERE user_id = %s ORDER BY created_at DESC LIMIT %s""",
                (user_id, max(1, limit)),
            )
            return cur.fetchall()


def get_latest_emotion_label(user_id: int) -> Optional[dict]:
    """取该用户最近一条情绪标签。"""
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """SELECT id, user_id, emotion_label, created_at
                   FROM emotion_labels WHERE user_id = %s ORDER BY created_at DESC LIMIT 1""",
                (user_id,),
            )
            return cur.fetchone()


def init_db():
    """初始化数据库（创建表等）。"""
    create_users_table()
    create_emotion_labels_table()


if __name__ == "__main__":
    init_db()
    print("users 表、emotion_labels 表已创建或已存在。")
