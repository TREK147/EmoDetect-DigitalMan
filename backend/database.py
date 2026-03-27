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


# ---------- 情绪异常记录（存原因，供模型检索与对症疏导） ----------


def create_emotion_anomalies_table():
    """情绪异常表：对话/监控发现异常时写入。from_monitoring 0=聊天 1=监控；聊天时可存 reason。"""
    sql = """
    CREATE TABLE IF NOT EXISTS emotion_anomalies (
      id             INT          NOT NULL AUTO_INCREMENT PRIMARY KEY,
      user_id        INT          NOT NULL,
      emotion_label  VARCHAR(64)  NOT NULL COMMENT '情绪标签',
      reason         TEXT         NULL COMMENT '具体原因（来自聊天时填写，来自监控可空）',
      from_monitoring TINYINT     NOT NULL DEFAULT 0 COMMENT '0=聊天 1=监控',
      created_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
      KEY idx_user_created (user_id, created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='情绪异常记录'
    """
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(sql)
        conn.commit()


def _ensure_from_monitoring_column():
    """已有表补加 from_monitoring 列（兼容旧库）；若有 source 列则按 source 回填。"""
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """SELECT COUNT(*) AS n FROM information_schema.COLUMNS
                   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'emotion_anomalies' AND COLUMN_NAME = 'from_monitoring'"""
            )
            if cur.fetchone()["n"] == 0:
                cur.execute(
                    "ALTER TABLE emotion_anomalies ADD COLUMN from_monitoring TINYINT NOT NULL DEFAULT 0 COMMENT '0=聊天 1=监控' AFTER reason"
                )
                try:
                    cur.execute("UPDATE emotion_anomalies SET from_monitoring = 1 WHERE source = 'monitoring'")
                except Exception:
                    pass
        conn.commit()


def add_emotion_anomaly(user_id: int, emotion_label: str, reason: str = "", from_monitoring: int = 0) -> int:
    """写入一条情绪异常。from_monitoring: 0=聊天（可填 reason），1=监控。"""
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """INSERT INTO emotion_anomalies (user_id, emotion_label, reason, from_monitoring)
                   VALUES (%s, %s, %s, %s)""",
                (user_id, (emotion_label or "").strip()[:64], (reason or "").strip()[:2000] or None, 1 if from_monitoring else 0),
            )
            conn.commit()
            return cur.lastrowid


def get_emotion_anomalies_by_user(user_id: int, limit: int = 100, since_days: Optional[int] = None) -> list:
    with get_connection() as conn:
        with conn.cursor() as cur:
            if since_days is not None and since_days > 0:
                cur.execute(
                    """SELECT id, user_id, emotion_label, reason, from_monitoring, created_at
                       FROM emotion_anomalies WHERE user_id = %s AND created_at >= DATE_SUB(NOW(), INTERVAL %s DAY)
                       ORDER BY created_at DESC LIMIT %s""",
                    (user_id, since_days, max(1, limit)),
                )
            else:
                cur.execute(
                    """SELECT id, user_id, emotion_label, reason, from_monitoring, created_at
                       FROM emotion_anomalies WHERE user_id = %s ORDER BY created_at DESC LIMIT %s""",
                    (user_id, max(1, limit)),
                )
            return cur.fetchall()


def count_recent_anomalies(user_id: int, days: int = 7) -> int:
    """最近 N 天内异常次数，用于触发「多次异常则主动疏导」。"""
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """SELECT COUNT(*) AS n FROM emotion_anomalies
                   WHERE user_id = %s AND created_at >= DATE_SUB(NOW(), INTERVAL %s DAY)""",
                (user_id, max(1, days)),
            )
            row = cur.fetchone()
            return int(row["n"]) if row else 0


# ---------- 主动疏导触发（监控/多次异常后由数字人主动发起） ----------


def create_proactive_triggers_table():
    sql = """
    CREATE TABLE IF NOT EXISTS proactive_triggers (
      id             INT      NOT NULL AUTO_INCREMENT PRIMARY KEY,
      user_id        INT      NOT NULL,
      trigger_type   VARCHAR(32) NOT NULL DEFAULT 'monitoring' COMMENT 'monitoring|repeated_anomaly',
      acknowledged_at DATETIME NULL COMMENT '用户已响应时间',
      created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      KEY idx_user_pending (user_id, acknowledged_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='主动疏导触发记录'
    """
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(sql)
        conn.commit()


def create_proactive_trigger(user_id: int, trigger_type: str = "monitoring") -> int:
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO proactive_triggers (user_id, trigger_type) VALUES (%s, %s)",
                (user_id, (trigger_type or "monitoring")[:32]),
            )
            conn.commit()
            return cur.lastrowid


def get_pending_proactive_trigger(user_id: int) -> Optional[dict]:
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """SELECT id, user_id, trigger_type, created_at FROM proactive_triggers
                   WHERE user_id = %s AND acknowledged_at IS NULL ORDER BY created_at DESC LIMIT 1""",
                (user_id,),
            )
            return cur.fetchone()


def acknowledge_proactive_trigger(trigger_id: int, user_id: int) -> bool:
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE proactive_triggers SET acknowledged_at = CURRENT_TIMESTAMP WHERE id = %s AND user_id = %s",
                (trigger_id, user_id),
            )
            conn.commit()
            return cur.rowcount > 0


def get_emotion_stats_by_user(user_id: int, days: int = 30) -> list:
    """按日聚合情绪异常数量，供情感曲线。返回 [{"date": "YYYY-MM-DD", "count": n}, ...]。"""
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """SELECT DATE(created_at) AS date, COUNT(*) AS count
                   FROM emotion_anomalies WHERE user_id = %s AND created_at >= DATE_SUB(CURDATE(), INTERVAL %s DAY)
                   GROUP BY DATE(created_at) ORDER BY date ASC""",
                (user_id, max(1, days)),
            )
            rows = cur.fetchall()
    return [{"date": (r["date"].isoformat() if hasattr(r["date"], "isoformat") else str(r["date"])), "count": r["count"]} for r in rows]


# ---------- 用户日程（从对话提取或手动添加） ----------


def create_user_schedules_table():
    sql = """
    CREATE TABLE IF NOT EXISTS user_schedules (
      id           INT          NOT NULL AUTO_INCREMENT PRIMARY KEY,
      user_id      INT          NOT NULL,
      title        VARCHAR(500) NOT NULL COMMENT '事项标题',
      scheduled_at DATETIME     NOT NULL COMMENT '计划时间',
      end_at       DATETIME     NULL COMMENT '结束时间',
      source       VARCHAR(32)  NOT NULL DEFAULT 'conversation' COMMENT 'conversation|manual',
      raw_text     TEXT         NULL COMMENT '原始对话片段',
      status       VARCHAR(20)  NOT NULL DEFAULT 'pending' COMMENT 'pending|done|cancelled',
      created_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
      KEY idx_user_time (user_id, scheduled_at),
      KEY idx_user_status (user_id, status)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='用户日程'
    """
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(sql)
        conn.commit()


def create_students_table():
    """创建学生表（用于人脸库），支持逻辑删除。"""
    sql = """
    CREATE TABLE IF NOT EXISTS student (
      id            INT          NOT NULL AUTO_INCREMENT PRIMARY KEY,
      student_id    VARCHAR(64)  NOT NULL COMMENT '学号（唯一）',
      name          VARCHAR(100) NOT NULL COMMENT '姓名',
      face_feature  LONGTEXT     NULL COMMENT '人脸特征向量（JSON）',
      is_deleted    TINYINT      NOT NULL DEFAULT 0 COMMENT '逻辑删除标记 0/1',
      deleted_at    DATETIME     NULL COMMENT '逻辑删除时间',
      created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uk_student_id (student_id),
      KEY idx_student_deleted (is_deleted)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='学生人脸库'
    """
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(sql)
        conn.commit()


def create_emotion_records_table():
    """创建识别记录表，支持逻辑删除。"""
    sql = """
    CREATE TABLE IF NOT EXISTS emotion_record (
      id            BIGINT       NOT NULL AUTO_INCREMENT PRIMARY KEY,
      student_id    VARCHAR(64)  NOT NULL COMMENT '学号',
      emotion_type  VARCHAR(64)  NOT NULL COMMENT '情绪标签',
      intensity     DECIMAL(5,2) NOT NULL COMMENT '情绪置信度',
      timestamp     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '记录时间',
      is_deleted    TINYINT      NOT NULL DEFAULT 0 COMMENT '逻辑删除标记 0/1',
      deleted_at    DATETIME     NULL COMMENT '逻辑删除时间',
      KEY idx_record_student_time (student_id, timestamp),
      KEY idx_record_deleted (is_deleted)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='学生情绪识别记录'
    """
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(sql)
        conn.commit()


def _ensure_soft_delete_columns(table_name: str):
    """兼容旧表：补齐 is_deleted / deleted_at 字段。"""
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """SELECT COUNT(*) AS n FROM information_schema.COLUMNS
                   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = %s AND COLUMN_NAME = 'is_deleted'""",
                (table_name,),
            )
            if cur.fetchone()["n"] == 0:
                cur.execute(
                    f"ALTER TABLE {table_name} ADD COLUMN is_deleted TINYINT NOT NULL DEFAULT 0 COMMENT '逻辑删除标记 0/1'"
                )
            cur.execute(
                """SELECT COUNT(*) AS n FROM information_schema.COLUMNS
                   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = %s AND COLUMN_NAME = 'deleted_at'""",
                (table_name,),
            )
            if cur.fetchone()["n"] == 0:
                cur.execute(
                    f"ALTER TABLE {table_name} ADD COLUMN deleted_at DATETIME NULL COMMENT '逻辑删除时间'"
                )
        conn.commit()


def upsert_student(student_id: str, name: str, face_feature_json: Optional[str] = None) -> None:
    """新增或更新学生（若已逻辑删除会恢复）。"""
    with get_connection() as conn:
        with conn.cursor() as cur:
            if face_feature_json is None:
                cur.execute(
                    """INSERT INTO student (student_id, name, is_deleted, deleted_at)
                       VALUES (%s, %s, 0, NULL)
                       ON DUPLICATE KEY UPDATE
                       name = VALUES(name),
                       is_deleted = 0,
                       deleted_at = NULL""",
                    ((student_id or "").strip(), (name or "").strip()[:100]),
                )
            else:
                cur.execute(
                    """INSERT INTO student (student_id, name, face_feature, is_deleted, deleted_at)
                       VALUES (%s, %s, %s, 0, NULL)
                       ON DUPLICATE KEY UPDATE
                       name = VALUES(name),
                       face_feature = VALUES(face_feature),
                       is_deleted = 0,
                       deleted_at = NULL""",
                    ((student_id or "").strip(), (name or "").strip()[:100], face_feature_json),
                )
        conn.commit()


def list_students(include_deleted: bool = False, limit: int = 200) -> list:
    with get_connection() as conn:
        with conn.cursor() as cur:
            if include_deleted:
                cur.execute(
                    """SELECT id, student_id, name, face_feature, is_deleted, deleted_at, created_at, updated_at
                       FROM student ORDER BY updated_at DESC LIMIT %s""",
                    (max(1, limit),),
                )
            else:
                cur.execute(
                    """SELECT id, student_id, name, face_feature, is_deleted, deleted_at, created_at, updated_at
                       FROM student WHERE is_deleted = 0 ORDER BY updated_at DESC LIMIT %s""",
                    (max(1, limit),),
                )
            return cur.fetchall()


def get_student_by_student_id(student_id: str, include_deleted: bool = False) -> Optional[dict]:
    with get_connection() as conn:
        with conn.cursor() as cur:
            if include_deleted:
                cur.execute(
                    """SELECT id, student_id, name, face_feature, is_deleted, deleted_at, created_at, updated_at
                       FROM student WHERE student_id = %s LIMIT 1""",
                    ((student_id or "").strip(),),
                )
            else:
                cur.execute(
                    """SELECT id, student_id, name, face_feature, is_deleted, deleted_at, created_at, updated_at
                       FROM student WHERE student_id = %s AND is_deleted = 0 LIMIT 1""",
                    ((student_id or "").strip(),),
                )
            return cur.fetchone()


def soft_delete_student(student_id: str) -> bool:
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """UPDATE student
                   SET is_deleted = 1, deleted_at = CURRENT_TIMESTAMP
                   WHERE student_id = %s AND is_deleted = 0""",
                ((student_id or "").strip(),),
            )
            conn.commit()
            return cur.rowcount > 0


def update_student(student_id: str, name: Optional[str] = None) -> bool:
    updates = []
    args = []
    if name is not None:
        updates.append("name = %s")
        args.append((name or "").strip()[:100])
    if not updates:
        return True
    args.extend([(student_id or "").strip()])
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE student SET " + ", ".join(updates) + " WHERE student_id = %s AND is_deleted = 0",
                tuple(args),
            )
            conn.commit()
            return cur.rowcount > 0


def load_face_database() -> dict:
    """返回 { student_id: np.array(feature) } 的原始 JSON 结构数据。"""
    rows = list_students(include_deleted=False, limit=5000)
    out = {}
    for row in rows:
        feature = row.get("face_feature")
        if feature:
            out[row["student_id"]] = feature
    return out


def add_emotion_record(student_id: str, emotion_type: str, intensity: float) -> int:
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """INSERT INTO emotion_record (student_id, emotion_type, intensity)
                   VALUES (%s, %s, %s)""",
                ((student_id or "").strip(), (emotion_type or "").strip()[:64], float(intensity)),
            )
            conn.commit()
            return cur.lastrowid


def list_emotion_records(student_id: Optional[str] = None, limit: int = 200) -> list:
    with get_connection() as conn:
        with conn.cursor() as cur:
            if student_id:
                cur.execute(
                    """SELECT id, student_id, emotion_type, intensity, timestamp, is_deleted, deleted_at
                       FROM emotion_record
                       WHERE is_deleted = 0 AND student_id = %s
                       ORDER BY timestamp DESC LIMIT %s""",
                    ((student_id or "").strip(), max(1, limit)),
                )
            else:
                cur.execute(
                    """SELECT id, student_id, emotion_type, intensity, timestamp, is_deleted, deleted_at
                       FROM emotion_record
                       WHERE is_deleted = 0
                       ORDER BY timestamp DESC LIMIT %s""",
                    (max(1, limit),),
                )
            return cur.fetchall()


def soft_delete_emotion_record(record_id: int) -> bool:
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """UPDATE emotion_record
                   SET is_deleted = 1, deleted_at = CURRENT_TIMESTAMP
                   WHERE id = %s AND is_deleted = 0""",
                (record_id,),
            )
            conn.commit()
            return cur.rowcount > 0


def create_schedule(user_id: int, title: str, scheduled_at: str, end_at: Optional[str] = None, source: str = "conversation", raw_text: Optional[str] = None) -> int:
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """INSERT INTO user_schedules (user_id, title, scheduled_at, end_at, source, raw_text)
                   VALUES (%s, %s, %s, %s, %s, %s)""",
                (user_id, (title or "").strip()[:500], scheduled_at, end_at, (source or "conversation")[:32], (raw_text or "")[:2000]),
            )
            conn.commit()
            return cur.lastrowid


def get_schedules_by_user(user_id: int, start_date: Optional[str] = None, end_date: Optional[str] = None, limit: int = 200) -> list:
    with get_connection() as conn:
        with conn.cursor() as cur:
            if start_date and end_date:
                cur.execute(
                    """SELECT id, user_id, title, scheduled_at, end_at, source, raw_text, status, created_at
                       FROM user_schedules WHERE user_id = %s AND status = 'pending'
                       AND scheduled_at >= %s AND scheduled_at <= %s
                       ORDER BY scheduled_at ASC LIMIT %s""",
                    (user_id, start_date, end_date, max(1, limit)),
                )
            else:
                cur.execute(
                    """SELECT id, user_id, title, scheduled_at, end_at, source, raw_text, status, created_at
                       FROM user_schedules WHERE user_id = %s ORDER BY scheduled_at DESC LIMIT %s""",
                    (user_id, max(1, limit)),
                )
            return cur.fetchall()


def get_schedule_by_id(schedule_id: int, user_id: int) -> Optional[dict]:
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT id, user_id, title, scheduled_at, end_at, source, raw_text, status, created_at FROM user_schedules WHERE id = %s AND user_id = %s",
                (schedule_id, user_id),
            )
            return cur.fetchone()


def update_schedule(schedule_id: int, user_id: int, title: Optional[str] = None, scheduled_at: Optional[str] = None, end_at: Optional[str] = None, status: Optional[str] = None) -> bool:
    updates, args = [], []
    if title is not None:
        updates.append("title = %s")
        args.append((title or "").strip()[:500])
    if scheduled_at is not None:
        updates.append("scheduled_at = %s")
        args.append(scheduled_at)
    if end_at is not None:
        updates.append("end_at = %s")
        args.append(end_at)
    if status is not None:
        updates.append("status = %s")
        args.append((status or "pending")[:20])
    if not updates:
        return True
    args.extend([schedule_id, user_id])
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("UPDATE user_schedules SET " + ", ".join(updates) + " WHERE id = %s AND user_id = %s", tuple(args))
            conn.commit()
            return cur.rowcount > 0


def delete_schedule(schedule_id: int, user_id: int) -> bool:
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM user_schedules WHERE id = %s AND user_id = %s", (schedule_id, user_id))
            conn.commit()
            return cur.rowcount > 0


def init_db():
    """初始化数据库（创建表等）。"""
    create_users_table()
    create_emotion_labels_table()
    create_conversations_table()
    create_messages_table()
    create_emotion_anomalies_table()
    _ensure_from_monitoring_column()
    create_proactive_triggers_table()
    create_user_schedules_table()
    create_students_table()
    create_emotion_records_table()
    _ensure_soft_delete_columns("student")
    _ensure_soft_delete_columns("emotion_record")


if __name__ == "__main__":
    init_db()
    print("users、emotion_labels、conversations、messages、emotion_anomalies、proactive_triggers、user_schedules 已创建或已存在。")
