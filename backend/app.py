"""
后端 API：为 frontend 提供 AI 对话、注册登录等接口。
"""
import secrets
import requests
from flask import Flask, request, jsonify
from flask_cors import CORS
from werkzeug.security import generate_password_hash, check_password_hash

from config import AUTODL_URL, API_KEY, CHAT_MODEL, MAX_TOKENS
import database as db

app = Flask(__name__)
CORS(app, origins=["*"])

# 启动时尝试创建 users 表（若 DB 不可用，注册时再报错）
try:
    db.init_db()
except Exception:
    pass

# 内存 token 存储：token -> user_id（重启后失效，生产可改为 Redis/JWT）
_tokens = {}


def _user_row_to_json(row):
    """将 DB 行转为前端 User 格式（id 转字符串）。"""
    if not row:
        return None
    return {
        "id": str(row["id"]),
        "username": row["username"],
        "email": row["mail"],
    }


def _require_auth():
    """从请求头取 token，校验并返回 user_id，失败返回 (None, response_tuple)。"""
    auth = request.headers.get("Authorization")
    if not auth or not auth.startswith("Bearer "):
        return None, (jsonify({"error": "未登录"}), 401)
    token = auth[7:].strip()
    user_id = _tokens.get(token)
    if not user_id:
        return None, (jsonify({"error": "登录已过期或无效"}), 401)
    return user_id, None


def build_messages(history: list, content: str) -> list:
    """将前端传来的历史 + 当前用户消息转为 OpenAPI messages 格式。"""
    messages = []
    for item in history or []:
        role = item.get("role", "user")
        if role not in ("user", "assistant", "system"):
            role = "user"
        messages.append({"role": role, "content": (item.get("content") or "").strip()})
    messages.append({"role": "user", "content": content.strip()})
    return messages


@app.route("/api/chat", methods=["POST"])
def chat():
    """
    请求体: { "content": "用户输入", "messages": [ { "role": "user"|"assistant", "content": "..." } ] }
    响应:   { "content": "AI 回复文本" }
    """
    try:
        data = request.get_json(force=True, silent=True) or {}
        content = (data.get("content") or "").strip()
        if not content:
            return jsonify({"error": "content 不能为空"}), 400

        history = data.get("messages") or []
        messages = build_messages(history, content)

        payload = {
            "model": CHAT_MODEL,
            "messages": messages,
            "max_tokens": MAX_TOKENS,
        }
        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {API_KEY}",
        }

        resp = requests.post(AUTODL_URL, json=payload, headers=headers, timeout=60)
        resp.raise_for_status()
        result = resp.json()
        ai_content = (
            result.get("choices", [{}])[0].get("message", {}).get("content", "")
        ).strip()
        return jsonify({"content": ai_content or "（无回复）"})
    except requests.RequestException as e:
        err_msg = str(e)
        if hasattr(e, "response") and e.response is not None:
            try:
                err_body = e.response.json()
                err_msg = err_body.get("error", {}).get("message", err_msg)
            except Exception:
                err_msg = e.response.text or err_msg
        return jsonify({"error": f"模型请求失败: {err_msg}"}), 502
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/health", methods=["GET"])
def health():
    return jsonify({"status": "ok"})


# ---------- 认证：注册 / 登录 / 登出 / 当前用户 ----------


def _err(message, status=400):
    return jsonify({"error": message, "message": message}), status


@app.route("/api/auth/register", methods=["POST"])
def auth_register():
    """注册：body { username, email, password } -> { user, token }"""
    try:
        data = request.get_json(force=True, silent=True) or {}
        username = (data.get("username") or "").strip()
        email = (data.get("email") or "").strip().lower()
        password = data.get("password") or ""

        if not username:
            return _err("请输入用户名")
        if not email:
            return _err("请输入邮箱")
        if not password or len(password) < 6:
            return _err("密码至少 6 位")

        try:
            existing = db.get_user_by_mail(email)
        except Exception as e:
            return _err(f"数据库连接失败: {str(e)}", 500)
        if existing:
            return _err("该邮箱已注册", 409)

        password_hash = generate_password_hash(password, method="pbkdf2:sha256")
        try:
            user_id = db.create_user(email, username, password_hash)
        except Exception as e:
            return _err(f"注册失败: {str(e)}", 500)

        user_row = db.get_user_by_id(user_id)
        user = _user_row_to_json(user_row)
        token = secrets.token_urlsafe(32)
        _tokens[token] = user_id
        return jsonify({"user": user, "token": token})
    except Exception as e:
        return _err(f"注册异常: {str(e)}", 500)


@app.route("/api/auth/login", methods=["POST"])
def auth_login():
    """登录：body { email, password } -> { user, token }"""
    data = request.get_json(force=True, silent=True) or {}
    email = (data.get("email") or "").strip().lower()
    password = data.get("password") or ""

    if not email:
        return _err("请输入邮箱")
    if not password:
        return _err("请输入密码")

    row = db.get_user_by_mail(email)
    if not row or not check_password_hash(row["password_hash"], password):
        return _err("邮箱或密码错误", 401)

    user = _user_row_to_json(row)
    token = secrets.token_urlsafe(32)
    _tokens[token] = row["id"]
    return jsonify({"user": user, "token": token})


@app.route("/api/auth/logout", methods=["POST"])
def auth_logout():
    """登出：清除服务端 token（可选）。"""
    auth = request.headers.get("Authorization")
    if auth and auth.startswith("Bearer "):
        token = auth[7:].strip()
        _tokens.pop(token, None)
    return jsonify({"ok": True})


@app.route("/api/auth/me", methods=["GET"])
def auth_me():
    """当前用户：需要 Authorization: Bearer <token>"""
    user_id, err_res = _require_auth()
    if err_res:
        return err_res
    row = db.get_user_by_id(user_id)
    if not row:
        return _err("用户不存在", 404)
    return jsonify(_user_row_to_json(row))


# ---------- 情绪标签（与 users.id 对应，需登录） ----------


def _emotion_row_to_json(row):
    """将情绪记录转为 JSON（created_at 转字符串）。"""
    if not row:
        return None
    created = row.get("created_at")
    if hasattr(created, "isoformat"):
        created = created.isoformat()
    return {
        "id": row["id"],
        "user_id": row["user_id"],
        "emotion_label": row["emotion_label"],
        "created_at": created,
    }


@app.route("/api/emotion", methods=["POST"])
def emotion_add():
    """提交一条情绪标签。body { "emotion_label": "开心" }，需登录。"""
    user_id, err_res = _require_auth()
    if err_res:
        return err_res
    data = request.get_json(force=True, silent=True) or {}
    label = (data.get("emotion_label") or data.get("label") or "").strip()
    if not label:
        return _err("请输入情绪标签")
    try:
        row_id = db.add_emotion_label(int(user_id), label)
        row = db.get_emotion_labels_by_user(int(user_id), limit=1)
        if row:
            return jsonify(_emotion_row_to_json(row[0]))
        return jsonify({"id": row_id, "user_id": user_id, "emotion_label": label, "created_at": None})
    except Exception as e:
        return _err(f"保存失败: {str(e)}", 500)


@app.route("/api/emotion", methods=["GET"])
def emotion_list():
    """当前用户的情绪标签列表，按时间倒序。query: limit 默认 100。需登录。"""
    user_id, err_res = _require_auth()
    if err_res:
        return err_res
    try:
        limit = request.args.get("limit", type=int) or 100
        limit = min(max(1, limit), 500)
        rows = db.get_emotion_labels_by_user(int(user_id), limit=limit)
        return jsonify([_emotion_row_to_json(r) for r in rows])
    except Exception as e:
        return _err(f"查询失败: {str(e)}", 500)


@app.route("/api/emotion/latest", methods=["GET"])
def emotion_latest():
    """当前用户最近一条情绪标签。需登录。"""
    user_id, err_res = _require_auth()
    if err_res:
        return err_res
    try:
        row = db.get_latest_emotion_label(int(user_id))
        if not row:
            return jsonify(None)
        return jsonify(_emotion_row_to_json(row))
    except Exception as e:
        return _err(f"查询失败: {str(e)}", 500)


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=True)
