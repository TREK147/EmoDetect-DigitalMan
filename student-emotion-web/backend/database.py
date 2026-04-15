"""
学生情绪管理系统 — MySQL 表结构与数据访问。
表名前缀 sem_，可与同库中 EmoDetect 的 users 等表共存。
"""
import json
import os
import time
import uuid
from typing import Any, Optional

import pymysql
from pymysql.cursors import DictCursor

from config import MYSQL_DATABASE, MYSQL_HOST, MYSQL_PASSWORD, MYSQL_PORT, MYSQL_USER


def get_connection():
    return pymysql.connect(
        host=MYSQL_HOST,
        port=MYSQL_PORT,
        user=MYSQL_USER,
        password=MYSQL_PASSWORD,
        database=MYSQL_DATABASE,
        charset="utf8mb4",
        cursorclass=DictCursor,
    )


def _exec(sql: str, args: tuple = ()) -> None:
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(sql, args)
        conn.commit()


def _fetchone(sql: str, args: tuple = ()) -> Optional[dict]:
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(sql, args)
            return cur.fetchone()


def _fetchall(sql: str, args: tuple = ()) -> list:
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(sql, args)
            return cur.fetchall()


def _table_exists(table_name: str) -> bool:
    row = _fetchone(
        """SELECT COUNT(*) AS n FROM information_schema.TABLES
           WHERE TABLE_SCHEMA = %s AND TABLE_NAME = %s""",
        (MYSQL_DATABASE, table_name),
    )
    return bool(row and int(row.get("n", 0)) > 0)


def _safe_fetchall(sql: str, args: tuple = (), fallback: Optional[list] = None) -> list:
    try:
        return _fetchall(sql, args)
    except Exception:
        return [] if fallback is None else fallback


def _safe_fetchone(sql: str, args: tuple = ()) -> Optional[dict]:
    try:
        return _fetchone(sql, args)
    except Exception:
        return None


def _to_ts_ms(value: Any) -> int:
    if value is None:
        return int(time.time() * 1000)
    if isinstance(value, (int, float)):
        n = int(value)
        return n if n > 10_000_000_000 else n * 1000
    if hasattr(value, "timestamp"):
        try:
            return int(value.timestamp() * 1000)
        except Exception:
            return int(time.time() * 1000)
    return int(time.time() * 1000)


def _clamp_score(score: float) -> int:
    return max(0, min(100, int(round(score))))


def _score_from_intensity(intensity: Any) -> int:
    try:
        val = float(intensity)
    except (TypeError, ValueError):
        return 50
    if val <= 1:
        return _clamp_score(val * 100)
    return _clamp_score(val)


def _mood_from_emotion_label(label: Any) -> str:
    text = str(label or "").strip().lower()
    if not text:
        return "中性"
    positive = {
        "happy",
        "happiness",
        "surprise",
        "excited",
        "positive",
        "joy",
        "高兴",
        "开心",
        "愉快",
        "惊喜",
    }
    negative = {
        "sad",
        "sadness",
        "angry",
        "anger",
        "fear",
        "disgust",
        "negative",
        "depressed",
        "悲伤",
        "难过",
        "焦虑",
        "生气",
        "愤怒",
        "恐惧",
    }
    if text in positive:
        return "积极"
    if text in negative:
        return "消极"
    return "中性"


def init_schema() -> None:
    stmts = [
        """
        CREATE TABLE IF NOT EXISTS sem_staff (
          id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
          staff_no VARCHAR(32) NOT NULL COMMENT '工号',
          name VARCHAR(100) NOT NULL,
          password_hash VARCHAR(64) NOT NULL,
          password_salt VARCHAR(64) NOT NULL,
          role VARCHAR(20) NOT NULL COMMENT 'ADMIN|COUNSELOR',
          role_name VARCHAR(100) NOT NULL,
          status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE' COMMENT 'ACTIVE|FROZEN|DISABLED|LOCKED',
          failed_login_count INT NOT NULL DEFAULT 0,
          locked_until_ms BIGINT NULL,
          last_login_ms BIGINT NULL,
          scope_json TEXT NULL COMMENT '辅导员数据范围 JSON',
          created_at_ms BIGINT NOT NULL,
          UNIQUE KEY uk_staff_no (staff_no),
          KEY idx_role (role)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        """,
        """
        CREATE TABLE IF NOT EXISTS sem_student (
          student_no VARCHAR(32) NOT NULL PRIMARY KEY,
          name VARCHAR(100) NOT NULL,
          college_id VARCHAR(32) NOT NULL,
          college_name VARCHAR(100) NOT NULL,
          grade VARCHAR(20) NOT NULL,
          major VARCHAR(100) NOT NULL,
          class_id VARCHAR(32) NOT NULL,
          class_name VARCHAR(100) NOT NULL,
          phone VARCHAR(32) NOT NULL,
          id_card_no VARCHAR(32) NOT NULL,
          KEY idx_college_grade (college_id, grade, major, class_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        """,
        """
        CREATE TABLE IF NOT EXISTS sem_emotion_point (
          id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
          student_no VARCHAR(32) NOT NULL,
          ts_ms BIGINT NOT NULL,
          score INT NOT NULL,
          mood VARCHAR(10) NOT NULL COMMENT '积极|中性|消极',
          source VARCHAR(32) NOT NULL,
          KEY idx_student_ts (student_no, ts_ms)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        """,
        """
        CREATE TABLE IF NOT EXISTS sem_report (
          id VARCHAR(64) NOT NULL PRIMARY KEY,
          student_no VARCHAR(32) NOT NULL,
          created_at_ms BIGINT NOT NULL,
          summary TEXT NOT NULL,
          risk_level VARCHAR(10) NOT NULL,
          tags_json TEXT NOT NULL,
          modality_json TEXT NOT NULL,
          KEY idx_student (student_no)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        """,
        """
        CREATE TABLE IF NOT EXISTS sem_alert (
          id VARCHAR(64) NOT NULL PRIMARY KEY,
          student_no VARCHAR(32) NOT NULL,
          student_name VARCHAR(100) NOT NULL,
          created_at_ms BIGINT NOT NULL,
          level VARCHAR(10) NOT NULL,
          reason TEXT NOT NULL,
          assigned_counselor_staff_no VARCHAR(32) NOT NULL,
          status VARCHAR(20) NOT NULL COMMENT 'NEW|FOLLOWED|CLEARED',
          note TEXT NULL,
          updated_at_ms BIGINT NULL,
          KEY idx_assignee (assigned_counselor_staff_no, status)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        """,
        """
        CREATE TABLE IF NOT EXISTS sem_threshold (
          id INT NOT NULL PRIMARY KEY DEFAULT 1,
          sensitivity INT NOT NULL DEFAULT 70,
          level_rules_json TEXT NOT NULL,
          updated_at_ms BIGINT NOT NULL,
          updated_by_staff_no VARCHAR(32) NULL
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        """,
        """
        CREATE TABLE IF NOT EXISTS sem_audit_log (
          id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
          action VARCHAR(64) NOT NULL,
          actor_staff_no VARCHAR(32) NULL,
          actor_name VARCHAR(100) NULL,
          target_student_no VARCHAR(32) NULL,
          target_staff_no VARCHAR(32) NULL,
          detail TEXT NOT NULL,
          ts_ms BIGINT NOT NULL,
          ip VARCHAR(64) NOT NULL,
          device VARCHAR(500) NOT NULL,
          KEY idx_ts (ts_ms),
          KEY idx_actor (actor_staff_no, ts_ms)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        """,
    ]
    for sql in stmts:
        _exec(sql)


def seed_demo_data() -> None:
    """若 sem_staff 为空则写入示例数据（仅供本地演示调试）。"""
    row = _fetchone("SELECT COUNT(*) AS c FROM sem_staff", ())
    if row and int(row["c"]) > 0:
        return

    import hashlib

    def md5_pw(plain: str, salt: str) -> str:
        return hashlib.md5(f"{salt}:{plain}".encode("utf-8")).hexdigest()

    now = int(time.time() * 1000)
    salt_a = "a1b2c3d4e5f6789012345678ab"
    salt_t = "b2c3d4e5f67890123456789abc"

    staff_rows = [
        (
            "A0001",
            "系统管理员",
            md5_pw("Admin@123", salt_a),
            salt_a,
            "ADMIN",
            "管理员",
            "ACTIVE",
            0,
            None,
            None,
            None,
            now,
        ),
        (
            "T10086",
            "张辅导员",
            md5_pw("Teacher@123", salt_t),
            salt_t,
            "COUNSELOR",
            "某学院辅导员",
            "ACTIVE",
            0,
            None,
            None,
            json.dumps(
                {
                    "collegeId": "C01",
                    "collegeName": "信息工程学院",
                    "grade": "2024",
                    "major": "软件工程",
                    "classIds": ["CL2401", "CL2402"],
                },
                ensure_ascii=False,
            ),
            now,
        ),
    ]

    with get_connection() as conn:
        with conn.cursor() as cur:
            for s in staff_rows:
                cur.execute(
                    """INSERT INTO sem_staff
                    (staff_no, name, password_hash, password_salt, role, role_name, status,
                     failed_login_count, locked_until_ms, last_login_ms, scope_json, created_at_ms)
                    VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
                    s,
                )

            students = [
                (
                    "20240001",
                    "李雷",
                    "C01",
                    "信息工程学院",
                    "2024",
                    "软件工程",
                    "CL2401",
                    "软工2401班",
                    "13912346705",
                    "320101200601019999",
                ),
                (
                    "20240002",
                    "韩梅梅",
                    "C01",
                    "信息工程学院",
                    "2024",
                    "软件工程",
                    "CL2402",
                    "软工2402班",
                    "13877776666",
                    "320101200602028888",
                ),
                (
                    "20230011",
                    "王强",
                    "C02",
                    "管理学院",
                    "2023",
                    "工商管理",
                    "CL2301",
                    "工管2301班",
                    "13700001111",
                    "320101200501017777",
                ),
            ]
            for st in students:
                cur.execute(
                    """INSERT INTO sem_student
                    (student_no, name, college_id, college_name, grade, major, class_id, class_name, phone, id_card_no)
                    VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
                    st,
                )

            one_day = 24 * 3600 * 1000
            # 情绪曲线数据由学生端（EmoDetect 聊天/人脸等）写入 sem_emotion_point

            r1 = f"rpt_{uuid.uuid4().hex[:12]}"
            r2 = f"rpt_{uuid.uuid4().hex[:12]}"
            cur.execute(
                """INSERT INTO sem_report (id, student_no, created_at_ms, summary, risk_level, tags_json, modality_json)
                VALUES (%s,%s,%s,%s,%s,%s,%s)""",
                (
                    r1,
                    "20240001",
                    now - 3 * one_day,
                    "近一周情绪整体偏稳定，数字人交互中出现轻度压力主题，建议关注学习与作息。",
                    "低",
                    json.dumps(["学习压力", "作息"], ensure_ascii=False),
                    json.dumps(["文本", "表情"], ensure_ascii=False),
                ),
            )
            cur.execute(
                """INSERT INTO sem_report (id, student_no, created_at_ms, summary, risk_level, tags_json, modality_json)
                VALUES (%s,%s,%s,%s,%s,%s,%s)""",
                (
                    r2,
                    "20240002",
                    now - 2 * one_day,
                    "情绪波动较明显，负向词频上升，建议进行一次线下谈话与支持性干预。",
                    "中",
                    json.dumps(["情绪波动", "人际"], ensure_ascii=False),
                    json.dumps(["文本", "语音"], ensure_ascii=False),
                ),
            )

            aid = f"alt_{uuid.uuid4().hex[:12]}"
            cur.execute(
                """INSERT INTO sem_alert
                (id, student_no, student_name, created_at_ms, level, reason, assigned_counselor_staff_no, status, note, updated_at_ms)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
                (
                    aid,
                    "20240002",
                    "韩梅梅",
                    now - 6 * 3600 * 1000,
                    "中",
                    "今日负向情绪占比上升，且连续 3 天均值下降。",
                    "T10086",
                    "NEW",
                    None,
                    None,
                ),
            )

            rules = [
                {"level": "低", "minScore": 60, "maxScore": 100},
                {"level": "中", "minScore": 45, "maxScore": 59.99},
                {"level": "高", "minScore": 30, "maxScore": 44.99},
                {"level": "危", "minScore": 0, "maxScore": 29.99},
            ]
            cur.execute(
                """INSERT INTO sem_threshold (id, sensitivity, level_rules_json, updated_at_ms, updated_by_staff_no)
                VALUES (1, %s, %s, %s, %s)
                ON DUPLICATE KEY UPDATE
                sensitivity=VALUES(sensitivity),
                level_rules_json=VALUES(level_rules_json),
                updated_at_ms=VALUES(updated_at_ms),
                updated_by_staff_no=VALUES(updated_by_staff_no)""",
                (70, json.dumps(rules, ensure_ascii=False), now, "A0001"),
            )
        conn.commit()


def staff_row_public(row: dict) -> dict:
    scope = None
    if row.get("scope_json"):
        try:
            scope = json.loads(row["scope_json"])
        except (json.JSONDecodeError, TypeError):
            scope = None
    return {
        "id": str(row["id"]),
        "staffNo": row["staff_no"],
        "name": row["name"],
        "role": row["role"],
        "roleName": row["role_name"],
        "scope": scope,
        "status": row["status"],
        "failedLoginCount": int(row["failed_login_count"] or 0),
        "lockedUntil": row["locked_until_ms"],
        "lastLoginAt": row["last_login_ms"],
        "createdAt": row["created_at_ms"],
    }


def student_row_public(row: dict) -> dict:
    return {
        "studentNo": row["student_no"],
        "name": row["name"],
        "collegeId": row["college_id"],
        "collegeName": row["college_name"],
        "grade": row["grade"],
        "major": row["major"],
        "classId": row["class_id"],
        "className": row["class_name"],
        "phone": row["phone"],
        "idCardNo": row["id_card_no"],
    }


def within_scope(staff: dict, student: dict) -> bool:
    if staff["role"] == "ADMIN":
        return True
    if not staff.get("scope_json"):
        return False
    try:
        s = json.loads(staff["scope_json"])
    except (json.JSONDecodeError, TypeError):
        return False
    # 兼容学生端核心表仅有学号/姓名的场景：当范围字段缺失时先放行，避免真实数据不可见。
    if not student.get("college_id") or not student.get("grade") or not student.get("major") or not student.get("class_id"):
        return True
    if s.get("collegeId") != student["college_id"]:
        return False
    if s.get("grade") != student["grade"]:
        return False
    if s.get("major") != student["major"]:
        return False
    class_ids = s.get("classIds") or []
    return student["class_id"] in class_ids


def get_staff_by_staff_no(staff_no: str) -> Optional[dict]:
    return _fetchone("SELECT * FROM sem_staff WHERE staff_no = %s", (staff_no.strip(),))


def get_staff_by_id(uid: int) -> Optional[dict]:
    return _fetchone("SELECT * FROM sem_staff WHERE id = %s", (uid,))


def list_all_staff() -> list:
    return _fetchall("SELECT * FROM sem_staff ORDER BY id", ())


def update_staff_password(uid: int, password_hash: str, password_salt: str) -> None:
    _exec(
        "UPDATE sem_staff SET password_hash=%s, password_salt=%s WHERE id=%s",
        (password_hash, password_salt, uid),
    )


def update_staff_role_scope(
    staff_no: str,
    role: str,
    role_name: str,
    scope_json: Optional[str],
) -> None:
    _exec(
        "UPDATE sem_staff SET role=%s, role_name=%s, scope_json=%s WHERE staff_no=%s",
        (role, role_name, scope_json, staff_no),
    )


def set_last_login(uid: int, ts_ms: int) -> None:
    _exec("UPDATE sem_staff SET last_login_ms=%s, failed_login_count=0 WHERE id=%s", (ts_ms, uid))


def mark_login_success(staff_id: int, now_ms: int, prev_status: str) -> None:
    """登录成功：清零失败次数、解锁时间，LOCKED 则恢复 ACTIVE，并记录最近登录时间。"""
    new_status = "ACTIVE" if prev_status == "LOCKED" else prev_status
    _exec(
        """UPDATE sem_staff SET failed_login_count=0, locked_until_ms=NULL,
        status=%s, last_login_ms=%s WHERE id=%s""",
        (new_status, now_ms, staff_id),
    )


def lock_staff_after_failed(staff_no: str, failed: int, lock_until_ms: int) -> None:
    _exec(
        "UPDATE sem_staff SET status=%s, locked_until_ms=%s, failed_login_count=%s WHERE staff_no=%s",
        ("LOCKED", lock_until_ms, failed, staff_no),
    )


def set_account_status(staff_no: str, status: str) -> None:
    """管理员设置账号状态；ACTIVE 时同时清除锁定与失败次数。"""
    if status == "ACTIVE":
        _exec(
            "UPDATE sem_staff SET status=%s, locked_until_ms=NULL, failed_login_count=0 WHERE staff_no=%s",
            (status, staff_no),
        )
    else:
        _exec("UPDATE sem_staff SET status=%s WHERE staff_no=%s", (status, staff_no))


def increment_failed_login(staff_no: str, count: int) -> None:
    _exec(
        "UPDATE sem_staff SET failed_login_count=%s WHERE staff_no=%s",
        (count, staff_no),
    )


def _build_student_row_from_core(row: dict) -> dict:
    student_no = (row.get("student_id") or "").strip()
    return {
        "student_no": student_no,
        "name": (row.get("name") or "").strip() or student_no,
        "college_id": row.get("college_id") or "",
        "college_name": row.get("college_name") or "未知学院",
        "grade": row.get("grade") or "",
        "major": row.get("major") or "",
        "class_id": row.get("class_id") or "",
        "class_name": row.get("class_name") or "未知班级",
        "phone": row.get("phone") or "",
        "id_card_no": row.get("id_card_no") or "",
    }


def list_students_unified() -> list:
    merged: dict[str, dict] = {}

    sem_rows = _safe_fetchall("SELECT * FROM sem_student", ())
    for r in sem_rows:
        sno = (r.get("student_no") or "").strip()
        if not sno:
            continue
        merged[sno] = r

    core_rows: list = []
    if _table_exists("student"):
        core_rows = _safe_fetchall(
            """SELECT student_id, name
               FROM student
               WHERE (is_deleted = 0 OR is_deleted IS NULL) AND student_id IS NOT NULL""",
            (),
        )

    for r in core_rows:
        sno = (r.get("student_id") or "").strip()
        if not sno:
            continue
        if sno in merged:
            merged[sno]["name"] = (r.get("name") or "").strip() or merged[sno]["name"]
            continue
        merged[sno] = _build_student_row_from_core(r)

    return list(merged.values())


def list_students_for_search(
    keyword: str,
    student_no: str,
    name: str,
    staff: dict,
) -> list:
    rows = list_students_unified()
    kw = (keyword or "").strip()
    sno = (student_no or "").strip()
    nm = (name or "").strip()
    out = []
    for r in rows:
        hit = (
            (not kw or kw in r["student_no"] or kw in r["name"])
            and (not sno or sno in r["student_no"])
            and (not nm or nm in r["name"])
        )
        if not hit:
            continue
        if not within_scope(staff, r):
            continue
        out.append(student_row_public(r))
    return out


def get_student_by_no(student_no: str) -> Optional[dict]:
    target = (student_no or "").strip()
    if not target:
        return None

    if _table_exists("student"):
        core = _safe_fetchone(
            """SELECT student_id, name
               FROM student
               WHERE student_id = %s AND (is_deleted = 0 OR is_deleted IS NULL)
               LIMIT 1""",
            (target,),
        )
        if core:
            sem = _safe_fetchone("SELECT * FROM sem_student WHERE student_no = %s", (target,))
            row = sem if sem else _build_student_row_from_core(core)
            row["name"] = (core.get("name") or "").strip() or row.get("name")
            return row

    return _safe_fetchone("SELECT * FROM sem_student WHERE student_no = %s", (target,))


def get_emotion_timeline(student_no: str) -> list:
    target = (student_no or "").strip()
    if not target:
        return []

    if _table_exists("emotion_record"):
        rows = _safe_fetchall(
            """SELECT timestamp, emotion_type, intensity
               FROM emotion_record
               WHERE student_id=%s AND (is_deleted=0 OR is_deleted IS NULL)
               ORDER BY timestamp ASC""",
            (target,),
        )
        if rows:
            return [
                {
                    "ts": _to_ts_ms(r.get("timestamp")),
                    "score": _score_from_intensity(r.get("intensity")),
                    "mood": _mood_from_emotion_label(r.get("emotion_type")),
                    "source": "人脸识别",
                }
                for r in rows
            ]

    legacy_rows = _safe_fetchall(
        "SELECT ts_ms, score, mood, source FROM sem_emotion_point WHERE student_no=%s ORDER BY ts_ms ASC",
        (target,),
    )
    return [
        {
            "ts": int(r["ts_ms"]),
            "score": int(r["score"]),
            "mood": r["mood"],
            "source": r["source"],
        }
        for r in legacy_rows
    ]


def get_reports_for_student(student_no: str) -> list:
    rows = _fetchall(
        "SELECT * FROM sem_report WHERE student_no=%s ORDER BY created_at_ms DESC",
        (student_no,),
    )
    out = []
    for r in rows:
        out.append(
            {
                "id": r["id"],
                "studentNo": r["student_no"],
                "createdAt": int(r["created_at_ms"]),
                "summary": r["summary"],
                "riskLevel": r["risk_level"],
                "tags": json.loads(r["tags_json"] or "[]"),
                "modality": json.loads(r["modality_json"] or "[]"),
            }
        )
    return out


def get_threshold() -> dict:
    row = _fetchone("SELECT * FROM sem_threshold WHERE id=1", ())
    if not row:
        return {
            "sensitivity": 70,
            "levelRules": [
                {"level": "低", "minScore": 60, "maxScore": 100},
                {"level": "中", "minScore": 45, "maxScore": 59.99},
                {"level": "高", "minScore": 30, "maxScore": 44.99},
                {"level": "危", "minScore": 0, "maxScore": 29.99},
            ],
            "updatedAt": int(time.time() * 1000),
            "updatedBy": None,
        }
    return {
        "sensitivity": int(row["sensitivity"]),
        "levelRules": json.loads(row["level_rules_json"] or "[]"),
        "updatedAt": int(row["updated_at_ms"]),
        "updatedBy": row.get("updated_by_staff_no"),
    }


def save_threshold(sensitivity: int, level_rules: list, staff_no: str) -> dict:
    now = int(time.time() * 1000)
    _exec(
        """INSERT INTO sem_threshold (id, sensitivity, level_rules_json, updated_at_ms, updated_by_staff_no)
        VALUES (1, %s, %s, %s, %s)
        ON DUPLICATE KEY UPDATE sensitivity=VALUES(sensitivity), level_rules_json=VALUES(level_rules_json),
        updated_at_ms=VALUES(updated_at_ms), updated_by_staff_no=VALUES(updated_by_staff_no)""",
        (sensitivity, json.dumps(level_rules, ensure_ascii=False), now, staff_no),
    )
    return get_threshold()


def list_audit_logs(limit: int = 500) -> list:
    rows = _fetchall(
        "SELECT * FROM sem_audit_log ORDER BY ts_ms DESC LIMIT %s",
        (min(max(1, limit), 2000),),
    )
    return [
        {
            "id": str(r["id"]),
            "action": r["action"],
            "actorStaffNo": r["actor_staff_no"],
            "actorName": r["actor_name"],
            "targetStudentNo": r["target_student_no"],
            "targetStaffNo": r["target_staff_no"],
            "detail": r["detail"],
            "ts": int(r["ts_ms"]),
            "ip": r["ip"],
            "device": r["device"],
        }
        for r in rows
    ]


def insert_audit(
    action: str,
    detail: str,
    ip: str,
    device: str,
    actor_staff_no: Optional[str] = None,
    actor_name: Optional[str] = None,
    target_student_no: Optional[str] = None,
    target_staff_no: Optional[str] = None,
) -> None:
    ts = int(time.time() * 1000)
    _exec(
        """INSERT INTO sem_audit_log
        (action, actor_staff_no, actor_name, target_student_no, target_staff_no, detail, ts_ms, ip, device)
        VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
        (action, actor_staff_no, actor_name, target_student_no, target_staff_no, detail, ts, ip, device),
    )


def list_alerts_for_staff(staff: dict) -> list:
    if staff["role"] == "ADMIN":
        rows = _safe_fetchall("SELECT * FROM sem_alert ORDER BY created_at_ms DESC", ())
    else:
        rows = _safe_fetchall(
            "SELECT * FROM sem_alert WHERE assigned_counselor_staff_no=%s ORDER BY created_at_ms DESC",
            (staff["staff_no"],),
        )

    persisted = [_alert_to_json(r) for r in rows]
    existing_active_student_nos = {
        x["studentNo"] for x in persisted if x["status"] in ("NEW", "FOLLOWED")
    }
    runtime = _build_runtime_alerts(staff)
    for item in runtime:
        if item["studentNo"] in existing_active_student_nos:
            continue
        persisted.append(item)
    persisted.sort(key=lambda x: x.get("createdAt", 0), reverse=True)
    return persisted


def _alert_to_json(r: dict) -> dict:
    return {
        "id": r["id"],
        "studentNo": r["student_no"],
        "studentName": r["student_name"],
        "createdAt": int(r["created_at_ms"]),
        "level": r["level"],
        "reason": r["reason"],
        "assignedCounselorStaffNo": r["assigned_counselor_staff_no"],
        "status": r["status"],
        "note": r["note"],
        "updatedAt": int(r["updated_at_ms"]) if r.get("updated_at_ms") else None,
    }


def get_alert_by_id(aid: str) -> Optional[dict]:
    return _fetchone("SELECT * FROM sem_alert WHERE id=%s", (aid,))


def materialize_runtime_alert(aid: str, staff: dict) -> Optional[dict]:
    """将实时计算告警写入 sem_alert，便于后续状态流转。"""
    if not (aid or "").startswith("runtime-"):
        return None
    student_no = aid.replace("runtime-", "", 1).strip()
    if not student_no:
        return None

    student = get_student_by_no(student_no)
    if not student or not within_scope(staff, student):
        return None

    existing = get_alert_by_id(aid)
    if existing:
        return existing

    timeline = get_emotion_timeline(student_no)
    if not timeline:
        return None
    recent = [p for p in timeline if p["ts"] >= int(time.time() * 1000) - 7 * 24 * 3600 * 1000]
    negatives = [p for p in recent if p["mood"] == "消极"]
    if len(negatives) < 3:
        return None

    level = _risk_level_from_score(float(timeline[-1]["score"]), get_threshold().get("levelRules") or [])
    reason = f"近7天识别到 {len(negatives)} 次消极情绪，建议跟进"
    created_at = int(timeline[-1]["ts"])
    assigned = staff["staff_no"] if staff["role"] != "ADMIN" else _resolve_counselor_assignee(student)
    _exec(
        """INSERT INTO sem_alert
           (id, student_no, student_name, created_at_ms, level, reason, assigned_counselor_staff_no, status, note, updated_at_ms)
           VALUES (%s,%s,%s,%s,%s,%s,%s,'NEW',NULL,NULL)""",
        (aid, student_no, student["name"], created_at, level, reason, assigned),
    )
    return get_alert_by_id(aid)


def _resolve_counselor_assignee(student: dict) -> str:
    """为管理员触发的运行时预警匹配一个辅导员工号。"""
    counselors = _safe_fetchall(
        "SELECT * FROM sem_staff WHERE role='COUNSELOR' AND status='ACTIVE' ORDER BY id ASC",
        (),
    )
    for counselor in counselors:
        if within_scope(counselor, student):
            return counselor["staff_no"]
    return "SYSTEM"


def update_alert(aid: str, status: str, note: Optional[str]) -> bool:
    now = int(time.time() * 1000)
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE sem_alert SET status=%s, note=%s, updated_at_ms=%s WHERE id=%s",
                (status, note, now, aid),
            )
            return cur.rowcount > 0


def visible_students(staff: dict) -> list:
    rows = list_students_unified()
    return [r for r in rows if within_scope(staff, r)]


def _risk_level_from_score(score: float, level_rules: list) -> str:
    for rule in level_rules or []:
        try:
            lo = float(rule.get("minScore"))
            hi = float(rule.get("maxScore"))
        except (TypeError, ValueError):
            continue
        if lo <= score <= hi:
            return str(rule.get("level") or "中")
    return "中"


def _build_runtime_alerts(staff: dict) -> list:
    now = int(time.time() * 1000)
    seven_days_ago = now - 7 * 24 * 3600 * 1000
    threshold = get_threshold()
    level_rules = threshold.get("levelRules") or []

    out = []
    for stu in visible_students(staff):
        timeline = get_emotion_timeline(stu["student_no"])
        recent = [p for p in timeline if int(p.get("ts", 0)) >= seven_days_ago]
        negatives = [p for p in recent if p.get("mood") == "消极"]
        if len(negatives) < 3:
            continue

        last = recent[-1] if recent else timeline[-1]
        score = float(last.get("score", 50))
        level = _risk_level_from_score(score, level_rules)
        ts = int(last.get("ts") or now)
        out.append(
            {
                "id": f"runtime-{stu['student_no']}",
                "studentNo": stu["student_no"],
                "studentName": stu["name"],
                "createdAt": ts,
                "level": level,
                "reason": f"近7天识别到 {len(negatives)} 次消极情绪，建议跟进",
                "assignedCounselorStaffNo": staff["staff_no"] if staff["role"] != "ADMIN" else "SYSTEM",
                "status": "NEW",
                "note": None,
                "updatedAt": None,
            }
        )
    return out


def compute_visualization(staff: dict, range_key: str) -> dict:
    """按当前可见学生聚合情绪可视化指标。"""
    vs = visible_students(staff)
    now = int(time.time() * 1000)
    one_day = 24 * 3600 * 1000

    today_scores = []
    latest_points = {}
    for s in vs:
        points = get_emotion_timeline(s["student_no"])
        latest = points[-1] if points else None
        latest_points[s["student_no"]] = (points, latest)
        sc = int(latest["score"]) if latest else 50
        today_scores.append(sc)
    avg = sum(today_scores) / len(today_scores) if today_scores else 0.0

    dist = {"积极": 0, "中性": 0, "消极": 0}
    for s in vs:
        _, latest = latest_points.get(s["student_no"], ([], None))
        mood = latest["mood"] if latest else "中性"
        if mood in dist:
            dist[mood] += 1

    days = 7 if range_key == "week" else 30 if range_key == "month" else 120
    series = []
    for i in range(days - 1, -1, -1):
        day_start = now - i * one_day
        day_scores = []
        for s in vs:
            points, _ = latest_points.get(s["student_no"], ([], None))
            if not points:
                continue
            nearest = min(points, key=lambda x: abs(int(x["ts"]) - day_start))
            day_scores.append(int(nearest["score"]))
        series.append(
            {
                "ts": day_start,
                "avg": sum(day_scores) / len(day_scores) if day_scores else 0.0,
            }
        )

    if staff["role"] == "ADMIN":
        scope_label = "全校"
    else:
        try:
            sc = json.loads(staff["scope_json"] or "{}")
            scope_label = f"{sc.get('collegeName', '')}/{sc.get('grade', '')}/{sc.get('major', '')}"
        except (json.JSONDecodeError, TypeError):
            scope_label = "-"

    return {
        "scopeLabel": scope_label,
        "todayAvg": avg,
        "distribution": dist,
        "trend": series,
        "visibleCount": len(vs),
    }


def init_db() -> None:
    init_schema()
    # 默认关闭示例数据灌入，避免生产环境被演示数据污染。
    # 如需快速演示，可显式设置 SEM_ENABLE_DEMO_SEED=true。
    if (os.environ.get("SEM_ENABLE_DEMO_SEED", "false").strip().lower() in ("1", "true", "yes", "on")):
        seed_demo_data()
