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


# ---------- 会话与消息（聊天记录持久化） ----------


def create_conversations_table():
    """创建 conversations 表，与 users.id 对应。"""
    sql = """
    CREATE TABLE IF NOT EXISTS conversations (
      id            INT          NOT NULL AUTO_INCREMENT PRIMARY KEY COMMENT '主键',
      user_id       INT          NOT NULL COMMENT '用户 id',
      title         VARCHAR(255) NOT NULL DEFAULT '新对话' COMMENT '会话标题',
      last_message  VARCHAR(500) NULL COMMENT '最后一条消息摘要',
      pinned        TINYINT      NOT NULL DEFAULT 0 COMMENT '是否固定 0/1',
      created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      KEY idx_user_id (user_id),
      KEY idx_user_updated (user_id, updated_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='用户会话表'
    """
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(sql)
        conn.commit()


def create_messages_table():
    """创建 messages 表，与 conversations.id 对应。"""
    sql = """
    CREATE TABLE IF NOT EXISTS messages (
      id              INT          NOT NULL AUTO_INCREMENT PRIMARY KEY COMMENT '主键',
      conversation_id INT          NOT NULL COMMENT '会话 id',
      role            VARCHAR(20)  NOT NULL DEFAULT 'user' COMMENT 'user | assistant',
      content         TEXT         NOT NULL COMMENT '消息内容',
      type            VARCHAR(20)  NOT NULL DEFAULT 'text' COMMENT 'text|image|file|voice|video',
      file_url        VARCHAR(500) NULL,
      file_name       VARCHAR(255) NULL,
      created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
      KEY idx_conv_id (conversation_id),
      KEY idx_conv_created (conversation_id, created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='会话消息表'
    """
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(sql)
        conn.commit()


def create_conversation(user_id: int, title: str = "新对话") -> int:
    """创建会话，返回 id。"""
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO conversations (user_id, title) VALUES (%s, %s)",
                (user_id, (title or "新对话").strip()[:255]),
            )
            conn.commit()
            return cur.lastrowid


def get_conversations_by_user(user_id: int, limit: int = 200) -> list:
    """按 user_id 查询会话列表，按 updated_at 倒序。"""
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """SELECT c.id, c.user_id, c.title, c.last_message AS last_message, c.pinned, c.created_at, c.updated_at,
                          (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id) AS message_count
                   FROM conversations c
                   WHERE c.user_id = %s
                   ORDER BY c.pinned DESC, c.updated_at DESC
                   LIMIT %s""",
                (user_id, max(1, limit)),
            )
            return cur.fetchall()


def get_conversation_by_id(conv_id: int, user_id: int) -> Optional[dict]:
    """查询单条会话，且需属于该 user_id。"""
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT id, user_id, title, last_message, pinned, created_at, updated_at FROM conversations WHERE id = %s AND user_id = %s",
                (conv_id, user_id),
            )
            return cur.fetchone()


def update_conversation(conv_id: int, user_id: int, title: Optional[str] = None, pinned: Optional[int] = None, last_message: Optional[str] = None, updated_at=None) -> bool:
    """更新会话（仅允许所属用户）。"""
    updates = []
    args = []
    if title is not None:
        updates.append("title = %s")
        args.append((title or "").strip()[:255])
    if pinned is not None:
        updates.append("pinned = %s")
        args.append(1 if pinned else 0)
    if last_message is not None:
        updates.append("last_message = %s")
        args.append((last_message or "")[:500])
    if not updates:
        return True
    args.extend([conv_id, user_id])
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE conversations SET " + ", ".join(updates) + " WHERE id = %s AND user_id = %s",
                tuple(args),
            )
            conn.commit()
            return cur.rowcount > 0


def delete_conversation(conv_id: int, user_id: int) -> bool:
    """删除会话及其消息（仅允许所属用户）。"""
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM messages WHERE conversation_id = %s", (conv_id,))
            cur.execute("DELETE FROM conversations WHERE id = %s AND user_id = %s", (conv_id, user_id))
            conn.commit()
            return cur.rowcount > 0


def create_message(conversation_id: int, role: str, content: str, msg_type: str = "text", file_url: Optional[str] = None, file_name: Optional[str] = None) -> int:
    """插入一条消息，返回 id。"""
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """INSERT INTO messages (conversation_id, role, content, type, file_url, file_name)
                   VALUES (%s, %s, %s, %s, %s, %s)""",
                (conversation_id, (role or "user").strip(), (content or "").strip(), (msg_type or "text").strip(), file_url, file_name),
            )
            conn.commit()
            return cur.lastrowid


def update_conversation_last_message(conv_id: int, last_message: str) -> None:
    """更新会话的 last_message 与 updated_at（由应用层在写入 message 后调用）。"""
    msg_preview = (last_message or "").strip()[:500]
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("UPDATE conversations SET last_message = %s, updated_at = CURRENT_TIMESTAMP WHERE id = %s", (msg_preview, conv_id))
        conn.commit()


def get_messages_by_conversation(conversation_id: int, limit: int = 500) -> list:
    """按会话 id 查询消息列表，按 created_at 正序。"""
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """SELECT id, conversation_id, role, content, type, file_url, file_name, created_at
                   FROM messages WHERE conversation_id = %s ORDER BY created_at ASC LIMIT %s""",
                (conversation_id, max(1, limit)),
            )
            return cur.fetchall()


def get_conversation_owner(conversation_id: int) -> Optional[int]:
    """返回会话所属 user_id，不存在则 None。"""
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT user_id FROM conversations WHERE id = %s", (conversation_id,))
            row = cur.fetchone()
            return row["user_id"] if row else None


def init_db():
    """初始化数据库（创建表等）。"""
    create_users_table()
    create_emotion_labels_table()
    create_conversations_table()
    create_messages_table()


if __name__ == "__main__":
    init_db()
    print("users 表、emotion_labels 表已创建或已存在。")
