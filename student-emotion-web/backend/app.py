"""
学生情绪管理系统 — Flask API（工号登录，与 student-emotion-web 前端配套）。
"""
import hashlib
import json
import re
import secrets
import time
from typing import Any, Optional, Tuple

from flask import Flask, request, jsonify
from flask_cors import CORS

import database as db
from config import SEM_APP_PORT, validate_config

app = Flask(__name__)
CORS(app, resources={r"/api/*": {"origins": "*"}})
validate_config()

# token -> staff_id
_tokens: dict[str, int] = {}


def hash_password_md5(plain: str, salt: str) -> str:
    return hashlib.md5(f"{salt}:{plain}".encode("utf-8")).hexdigest()


def password_meets_policy(pwd: str) -> bool:
    if not pwd or len(pwd) < 8:
        return False
    return bool(
        re.search(r"[A-Z]", pwd)
        and re.search(r"[a-z]", pwd)
        and re.search(r"\d", pwd)
        and re.search(r"[^A-Za-z0-9]", pwd)
    )


def ok(data: Any = True):
    return jsonify({"ok": True, "data": data})


def fail(code: str, message: str, status: int = 400):
    return jsonify({"ok": False, "code": code, "message": message}), status


def get_bearer_token() -> Optional[str]:
    auth = request.headers.get("Authorization") or ""
    if auth.startswith("Bearer "):
        return auth[7:].strip()
    return None


def require_auth() -> Tuple[Optional[dict], Any]:
    token = get_bearer_token()
    if not token or token not in _tokens:
        return None, fail("UNAUTH", "未登录或会话已失效", 401)
    uid = _tokens[token]
    row = db.get_staff_by_id(uid)
    if not row:
        return None, fail("UNAUTH", "用户不存在", 401)
    now = int(time.time() * 1000)
    if row["status"] == "DISABLED":
        return None, fail("DISABLED", "账号已停用", 403)
    if row["status"] == "FROZEN":
        return None, fail("FROZEN", "账号已冻结", 403)
    if row["status"] == "LOCKED" and row.get("locked_until_ms") and row["locked_until_ms"] > now:
        return None, fail("LOCKED", "账号已锁定，请稍后再试", 403)
    return row, None


def require_role(staff: dict, roles: list) -> Any:
    if staff["role"] not in roles:
        return fail("FORBIDDEN", "无权限访问", 403)
    return None


def client_ip() -> str:
    return request.headers.get("X-Forwarded-For", "").split(",")[0].strip() or (request.remote_addr or "")


def client_device() -> str:
    return request.headers.get("User-Agent", "")[:500]


def revoke_sessions_for_staff(staff_id: int) -> None:
    to_del = [t for t, uid in _tokens.items() if uid == staff_id]
    for t in to_del:
        _tokens.pop(t, None)


@app.route("/api/health", methods=["GET"])
def health():
    return jsonify({"status": "ok", "service": "student-emotion-api"})


@app.route("/api/auth/login", methods=["POST"])
def auth_login():
    data = request.get_json(force=True, silent=True) or {}
    staff_no = (data.get("staffNo") or "").strip()
    password = data.get("password") or ""
    captcha_text = (data.get("captchaText") or "").strip()
    captcha_expected = (data.get("captchaExpected") or "").strip()

    if captcha_text.lower() != captcha_expected.lower():
        db.insert_audit(
            "LOGIN_FAIL",
            "验证码错误",
            client_ip(),
            client_device(),
            actor_staff_no=staff_no or None,
        )
        return fail("CAPTCHA", "验证码错误")

    row = db.get_staff_by_staff_no(staff_no)
    if not row:
        db.insert_audit(
            "LOGIN_FAIL",
            "账号不存在",
            client_ip(),
            client_device(),
            actor_staff_no=staff_no,
        )
        return fail("CREDENTIALS", "账号或密码错误")

    now = int(time.time() * 1000)

    if row["status"] == "DISABLED":
        db.insert_audit(
            "LOGIN_FAIL",
            "账号已停用",
            client_ip(),
            client_device(),
            actor_staff_no=staff_no,
            actor_name=row["name"],
        )
        return fail("DISABLED", "账号已停用")

    if row["status"] == "FROZEN":
        db.insert_audit(
            "LOGIN_FAIL",
            "账号已冻结",
            client_ip(),
            client_device(),
            actor_staff_no=staff_no,
            actor_name=row["name"],
        )
        return fail("FROZEN", "账号已冻结")

    if row["status"] == "LOCKED" and row.get("locked_until_ms") and row["locked_until_ms"] > now:
        db.insert_audit(
            "LOGIN_FAIL",
            "账号锁定期内登录",
            client_ip(),
            client_device(),
            actor_staff_no=staff_no,
            actor_name=row["name"],
        )
        return fail("LOCKED", "连续多次失败，账号已锁定，请稍后再试")

    computed = hash_password_md5(password, row["password_salt"])
    if computed != row["password_hash"]:
        failed = int(row["failed_login_count"] or 0) + 1
        db.increment_failed_login(staff_no, failed)
        db.insert_audit(
            "LOGIN_FAIL",
            f"密码错误（失败次数={failed}）",
            client_ip(),
            client_device(),
            actor_staff_no=staff_no,
            actor_name=row["name"],
        )
        if failed >= 5:
            lock_until = now + 10 * 60 * 1000
            db.lock_staff_after_failed(staff_no, failed, lock_until)
        return fail("CREDENTIALS", "账号或密码错误")

    # success
    db.mark_login_success(int(row["id"]), now, row["status"])
    fresh = db.get_staff_by_id(row["id"]) or row

    token = secrets.token_urlsafe(32)
    _tokens[token] = fresh["id"]

    db.insert_audit(
        "LOGIN_SUCCESS",
        f"登录成功 | ip={client_ip()} | device={client_device()[:200]}",
        client_ip(),
        client_device(),
        actor_staff_no=fresh["staff_no"],
        actor_name=fresh["name"],
    )

    return ok({"token": token, "role": fresh["role"], "roleName": fresh["role_name"]})


@app.route("/api/auth/logout", methods=["POST"])
def auth_logout():
    token = get_bearer_token()
    if token and token in _tokens:
        _tokens.pop(token, None)
    return ok(True)


@app.route("/api/auth/me", methods=["GET"])
def auth_me():
    staff, err = require_auth()
    if err:
        return err
    return ok(db.staff_row_public(staff))


@app.route("/api/auth/change-password", methods=["POST"])
def auth_change_password():
    staff, err = require_auth()
    if err:
        return err
    data = request.get_json(force=True, silent=True) or {}
    old_p = data.get("oldPassword") or ""
    new_p = data.get("newPassword") or ""

    if hash_password_md5(old_p, staff["password_salt"]) != staff["password_hash"]:
        return fail("OLD_PASSWORD", "原密码不正确")

    if not password_meets_policy(new_p):
        return fail("POLICY", "新密码不符合复杂度要求")

    new_salt = secrets.token_hex(16)
    new_hash = hash_password_md5(new_p, new_salt)
    db.update_staff_password(staff["id"], new_hash, new_salt)

    db.insert_audit(
        "PASSWORD_CHANGE",
        "用户修改密码（重新加盐哈希存储）",
        client_ip(),
        client_device(),
        actor_staff_no=staff["staff_no"],
        actor_name=staff["name"],
    )
    return ok(True)


@app.route("/api/admin/accounts", methods=["GET"])
def admin_accounts():
    staff, err = require_auth()
    if err:
        return err
    r = require_role(staff, ["ADMIN"])
    if r:
        return r
    rows = db.list_all_staff()
    out = []
    for x in rows:
        scope = None
        if x.get("scope_json"):
            try:
                scope = json.loads(x["scope_json"])
            except (json.JSONDecodeError, TypeError):
                scope = None
        out.append(
            {
                "id": str(x["id"]),
                "staffNo": x["staff_no"],
                "name": x["name"],
                "role": x["role"],
                "roleName": x["role_name"],
                "scope": scope,
                "status": x["status"],
                "failedLoginCount": int(x["failed_login_count"] or 0),
                "lockedUntil": x["locked_until_ms"],
                "lastLoginAt": x["last_login_ms"],
            }
        )
    return ok(out)


@app.route("/api/admin/accounts/status", methods=["POST"])
def admin_accounts_status():
    actor, err = require_auth()
    if err:
        return err
    r = require_role(actor, ["ADMIN"])
    if r:
        return r
    data = request.get_json(force=True, silent=True) or {}
    staff_no = (data.get("staffNo") or "").strip()
    status = (data.get("status") or "").strip()
    if status not in ("ACTIVE", "FROZEN", "DISABLED"):
        return fail("BAD_REQUEST", "无效状态")

    target = db.get_staff_by_staff_no(staff_no)
    if not target:
        return fail("NOT_FOUND", "账号不存在")

    db.set_account_status(staff_no, status)

    action_map = {"FROZEN": "ACCOUNT_FREEZE", "DISABLED": "ACCOUNT_DISABLE", "ACTIVE": "ACCOUNT_ENABLE"}
    db.insert_audit(
        action_map.get(status, "ACCOUNT_ENABLE"),
        f"管理员将账号状态设置为 {status}",
        client_ip(),
        client_device(),
        actor_staff_no=actor["staff_no"],
        actor_name=actor["name"],
        target_staff_no=staff_no,
    )

    if status != "ACTIVE":
        revoke_sessions_for_staff(int(target["id"]))
        db.insert_audit(
            "ACCOUNT_FORCE_LOGOUT",
            "因冻结/停用触发强制下线",
            client_ip(),
            client_device(),
            actor_staff_no=actor["staff_no"],
            actor_name=actor["name"],
            target_staff_no=staff_no,
        )

    return ok(True)


@app.route("/api/admin/role-scope", methods=["POST"])
def admin_role_scope():
    actor, err = require_auth()
    if err:
        return err
    r = require_role(actor, ["ADMIN"])
    if r:
        return r
    data = request.get_json(force=True, silent=True) or {}
    staff_no = (data.get("staffNo") or "").strip()
    role = (data.get("role") or "").strip()
    role_name = (data.get("roleName") or "").strip()
    scope = data.get("scope")

    if role not in ("ADMIN", "COUNSELOR"):
        return fail("BAD_REQUEST", "无效角色")

    scope_json = None if role == "ADMIN" else json.dumps(scope, ensure_ascii=False)
    db.update_staff_role_scope(staff_no, role, role_name, scope_json)

    db.insert_audit(
        "ROLE_SCOPE_UPDATE",
        f"更新角色与数据管辖范围：role={role} | scope={scope_json or 'null'}",
        client_ip(),
        client_device(),
        actor_staff_no=actor["staff_no"],
        actor_name=actor["name"],
        target_staff_no=staff_no,
    )
    return ok(True)


@app.route("/api/admin/thresholds", methods=["GET"])
def admin_get_threshold():
    staff, err = require_auth()
    if err:
        return err
    r = require_role(staff, ["ADMIN"])
    if r:
        return r
    t = db.get_threshold()
    return ok(
        {
            "sensitivity": t["sensitivity"],
            "levelRules": t["levelRules"],
            "updatedAt": t["updatedAt"],
            "updatedBy": t.get("updatedBy"),
        }
    )


@app.route("/api/admin/thresholds", methods=["POST"])
def admin_post_threshold():
    staff, err = require_auth()
    if err:
        return err
    r = require_role(staff, ["ADMIN"])
    if r:
        return r
    data = request.get_json(force=True, silent=True) or {}
    sensitivity = int(data.get("sensitivity", 70))
    level_rules = data.get("levelRules") or []
    saved = db.save_threshold(sensitivity, level_rules, staff["staff_no"])
    db.insert_audit(
        "THRESHOLD_UPDATE",
        f"调整预警阈值/敏感度：{json.dumps(data, ensure_ascii=False)}",
        client_ip(),
        client_device(),
        actor_staff_no=staff["staff_no"],
        actor_name=staff["name"],
    )
    return ok(
        {
            "sensitivity": saved["sensitivity"],
            "levelRules": saved["levelRules"],
            "updatedAt": saved["updatedAt"],
            "updatedBy": saved.get("updatedBy"),
        }
    )


@app.route("/api/admin/audit-logs", methods=["GET"])
def admin_audit_logs():
    staff, err = require_auth()
    if err:
        return err
    r = require_role(staff, ["ADMIN"])
    if r:
        return r
    return ok(db.list_audit_logs(500))


@app.route("/api/counselor/students", methods=["GET"])
def counselor_students():
    staff, err = require_auth()
    if err:
        return err
    r = require_role(staff, ["COUNSELOR", "ADMIN"])
    if r:
        return r
    keyword = request.args.get("keyword") or ""
    student_no = request.args.get("studentNo") or ""
    name = request.args.get("name") or ""
    return ok(db.list_students_for_search(keyword, student_no, name, staff))


@app.route("/api/counselor/students/<student_no>/archive", methods=["GET"])
def counselor_archive(student_no: str):
    staff, err = require_auth()
    if err:
        return err
    r = require_role(staff, ["COUNSELOR", "ADMIN"])
    if r:
        return r
    st = db.get_student_by_no(student_no)
    if not st:
        return fail("NOT_FOUND", "学生不存在")
    if not db.within_scope(staff, st):
        return fail("SCOPE", "越权访问拦截：不在当前数据管辖范围内")

    db.insert_audit(
        "ARCHIVE_VIEW",
        f"访问学生数字心理档案：{st['student_no']}/{st['name']}",
        client_ip(),
        client_device(),
        actor_staff_no=staff["staff_no"],
        actor_name=staff["name"],
        target_student_no=st["student_no"],
    )
    timeline = db.get_emotion_timeline(student_no)
    reports = db.get_reports_for_student(student_no)
    return ok(
        {
            "student": db.student_row_public(st),
            "timeline": timeline,
            "reports": reports,
            "timelineSource": "emotion_record_first",
        }
    )


@app.route("/api/counselor/visualization", methods=["GET"])
def counselor_visualization():
    staff, err = require_auth()
    if err:
        return err
    r = require_role(staff, ["COUNSELOR", "ADMIN"])
    if r:
        return r
    range_key = request.args.get("range") or "week"
    if range_key not in ("week", "month", "term"):
        range_key = "week"
    return ok(db.compute_visualization(staff, range_key))


@app.route("/api/counselor/alerts", methods=["GET"])
def counselor_alerts():
    staff, err = require_auth()
    if err:
        return err
    r = require_role(staff, ["COUNSELOR", "ADMIN"])
    if r:
        return r
    return ok(db.list_alerts_for_staff(staff))


@app.route("/api/counselor/alerts/<aid>", methods=["POST"])
def counselor_alert_update(aid: str):
    staff, err = require_auth()
    if err:
        return err
    r = require_role(staff, ["COUNSELOR", "ADMIN"])
    if r:
        return r
    data = request.get_json(force=True, silent=True) or {}
    status = (data.get("status") or "").strip()
    note = data.get("note")
    if status not in ("NEW", "FOLLOWED", "CLEARED"):
        return fail("BAD_REQUEST", "无效状态")

    alert = db.get_alert_by_id(aid)
    if not alert:
        alert = db.materialize_runtime_alert(aid, staff)
    if not alert:
        return fail("NOT_FOUND", "预警不存在")
    if staff["role"] != "ADMIN":
        assigned = alert["assigned_counselor_staff_no"]
        if assigned != staff["staff_no"]:
            # 兼容管理员触发且暂未明确分配到个人的系统告警：允许在其管辖范围内处理。
            if assigned != "SYSTEM":
                return fail("FORBIDDEN", "无权操作该预警")
            st = db.get_student_by_no(alert["student_no"])
            if not st or not db.within_scope(staff, st):
                return fail("FORBIDDEN", "无权操作该预警")

    db.update_alert(aid, status, note)
    return ok(True)


if __name__ == "__main__":
    try:
        validate_config()
        db.init_db()
    except Exception as e:
        print("init_db warning:", e)
    app.run(host="0.0.0.0", port=SEM_APP_PORT, debug=True)
