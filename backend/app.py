"""
后端 API：为 frontend 提供 AI 对话、注册登录、文件上传等接口。
"""
import base64
import json
import os
import secrets
import uuid
import requests
from flask import Flask, request, jsonify, Response, send_from_directory
from flask_cors import CORS
from werkzeug.exceptions import RequestEntityTooLarge
from werkzeug.security import generate_password_hash, check_password_hash
from werkzeug.utils import secure_filename

from config import CHAT_API_URL, API_KEY, CHAT_MODEL, MAX_TOKENS
import database as db

# 单文件上传最大 10MB，与前端一致；超过时请求被拒绝
MAX_UPLOAD_BYTES = 10 * 1024 * 1024

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = MAX_UPLOAD_BYTES
CORS(app, origins=["*"])

@app.errorhandler(RequestEntityTooLarge)
def handle_too_large(e):
    return jsonify({"error": f"文件过大，单文件最大支持 10MB"}), 413

# 上传目录（相对 backend 的上级目录下的 uploads）
UPLOAD_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "uploads"))
os.makedirs(UPLOAD_DIR, exist_ok=True)

# 允许的扩展名
ALLOWED_IMAGE = {"jpg", "jpeg", "png", "gif", "webp"}
ALLOWED_VIDEO = {"mp4", "mov", "webm"}
ALLOWED_AUDIO = {"webm", "mp3", "wav", "ogg", "m4a"}
ALLOWED_EXT = ALLOWED_IMAGE | ALLOWED_VIDEO | ALLOWED_AUDIO | {"pdf", "doc", "docx", "txt"}

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


def build_messages(history: list, content: str, image_base64: str = None, image_mime: str = None) -> list:
    """
    将历史 + 当前用户消息转为 OpenAPI messages 格式。
    若 image_base64 存在，最后一条为多模态 content 数组（文本 + 图片）。
    """
    messages = []
    for item in history or []:
        role = item.get("role", "user")
        if role not in ("user", "assistant", "system"):
            role = "user"
        messages.append({"role": role, "content": (item.get("content") or "").strip()})

    text = (content or "").strip()
    if image_base64:
        mime = image_mime or "image/jpeg"
        data_url = f"data:{mime};base64,{image_base64}"
        parts = []
        if text:
            parts.append({"type": "text", "text": text})
        parts.append({"type": "image_url", "image_url": {"url": data_url}})
        messages.append({"role": "user", "content": parts})
    else:
        if not text:
            text = "（无文字内容）"
        messages.append({"role": "user", "content": text})
    return messages


def _resolve_image_from_request(data: dict):
    """从请求中解析出 image_base64 与 image_mime。支持 imageBase64 或 imageUrl（本地上传路径）。"""
    b64 = data.get("imageBase64") or data.get("image_base64")
    if b64:
        return b64, (data.get("imageMime") or data.get("image_mime") or "image/jpeg")
    url = data.get("imageUrl") or data.get("image_url")
    if url and isinstance(url, str) and "/api/uploads/" in url:
        try:
            rel = url.split("/api/uploads/", 1)[-1].lstrip("/")
            if ".." in rel or not rel:
                return None, None
            path = os.path.join(UPLOAD_DIR, rel)
            if os.path.isfile(path):
                with open(path, "rb") as f:
                    b64 = base64.b64encode(f.read()).decode("ascii")
                ext = os.path.splitext(path)[1].lower()
                mime = {".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".gif": "image/gif", ".webp": "image/webp"}.get(ext, "image/jpeg")
                return b64, mime
        except Exception:
            pass
    return None, None


@app.route("/api/upload", methods=["POST"])
def upload():
    """上传文件，返回 { url, fileName, mimeType, category }。category: image|video|file|voice。"""
    if "file" not in request.files:
        return jsonify({"error": "未选择文件"}), 400
    f = request.files["file"]
    if not f or not f.filename:
        return jsonify({"error": "无效文件"}), 400
    ext = (f.filename.rsplit(".", 1)[-1] or "").lower()
    if ext not in ALLOWED_EXT:
        return jsonify({"error": f"不支持的文件类型: {ext}"}), 400
    name = secure_filename(f.filename) or "file"
    if "." not in name:
        name = f"{name}.{ext}"
    sub = uuid.uuid4().hex[:8]
    save_dir = os.path.join(UPLOAD_DIR, sub)
    os.makedirs(save_dir, exist_ok=True)
    save_path = os.path.join(save_dir, name)
    f.save(save_path)
    rel = f"{sub}/{name}"
    url = f"/api/uploads/{rel}"
    if ext in ALLOWED_IMAGE:
        category = "image"
    elif ext in ALLOWED_VIDEO:
        category = "video"
    elif ext in ALLOWED_AUDIO:
        category = "voice"
    else:
        category = "file"
    mime = f.content_type or "application/octet-stream"
    return jsonify({"url": url, "fileName": name, "mimeType": mime, "category": category})


@app.route("/api/uploads/<path:rel>", methods=["GET"])
def serve_upload(rel):
    """提供上传文件的访问。"""
    if ".." in rel:
        return jsonify({"error": "非法路径"}), 400
    path = os.path.join(UPLOAD_DIR, rel)
    if not os.path.isfile(path):
        return jsonify({"error": "文件不存在"}), 404
    return send_from_directory(UPLOAD_DIR, rel, as_attachment=False)


@app.route("/api/chat", methods=["POST"])
def chat():
    """
    请求体: { "content": "用户输入", "messages": [...], 可选 "imageBase64"/"imageUrl", "attachmentHint" }
    响应:   { "content": "AI 回复文本" }
    """
    try:
        data = request.get_json(force=True, silent=True) or {}
        content = (data.get("content") or "").strip()
        attachment_hint = (data.get("attachmentHint") or data.get("attachment_hint") or "").strip()
        if not content and not attachment_hint:
            image_b64, _ = _resolve_image_from_request(data)
            if not image_b64:
                return jsonify({"error": "content 或附件不能为空"}), 400
        if attachment_hint and not content:
            content = attachment_hint
        image_b64, image_mime = _resolve_image_from_request(data)
        history = data.get("messages") or []
        messages = build_messages(history, content, image_b64, image_mime)

        payload = {
            "model": CHAT_MODEL,
            "messages": messages,
            "max_tokens": MAX_TOKENS,
        }
        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {API_KEY}",
        }

        resp = requests.post(CHAT_API_URL, json=payload, headers=headers, timeout=60)
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


def _conv_row_to_json(row):
    """会话行转前端格式。"""
    if not row:
        return None
    return {
        "id": str(row["id"]),
        "title": row.get("title") or "新对话",
        "lastMessage": (row.get("last_message") or "").strip(),
        "updatedAt": row["updated_at"].isoformat() if hasattr(row.get("updated_at"), "isoformat") else str(row.get("updated_at", "")),
        "messageCount": int(row.get("message_count", 0)),
        "pinned": bool(row.get("pinned")),
    }


def _msg_row_to_json(row):
    """消息行转前端格式：role assistant -> sender ai。"""
    if not row:
        return None
    role = (row.get("role") or "user").strip()
    return {
        "id": str(row["id"]),
        "content": (row.get("content") or "").strip(),
        "sender": "ai" if role == "assistant" else "user",
        "timestamp": row["created_at"].isoformat() if hasattr(row.get("created_at"), "isoformat") else str(row.get("created_at", "")),
        "type": (row.get("type") or "text").strip(),
        "fileUrl": (row.get("file_url") or "").strip() or None,
        "fileName": (row.get("file_name") or "").strip() or None,
    }


@app.route("/api/conversations", methods=["GET"])
def list_conversations():
    """当前用户的会话列表，需登录。"""
    user_id, err_res = _require_auth()
    if err_res:
        return err_res
    try:
        limit = request.args.get("limit", type=int) or 200
        limit = min(max(1, limit), 500)
        rows = db.get_conversations_by_user(int(user_id), limit=limit)
        return jsonify([_conv_row_to_json(r) for r in rows])
    except Exception as e:
        return _err("查询失败: " + str(e), 500)


@app.route("/api/conversations", methods=["POST"])
def create_conversation():
    """创建会话，需登录。body: { title? }"""
    user_id, err_res = _require_auth()
    if err_res:
        return err_res
    try:
        data = request.get_json(force=True, silent=True) or {}
        title = (data.get("title") or "新对话").strip()[:255]
        conv_id = db.create_conversation(int(user_id), title)
        row = db.get_conversation_by_id(conv_id, int(user_id))
        return jsonify(_conv_row_to_json(row))
    except Exception as e:
        return _err("创建失败: " + str(e), 500)


@app.route("/api/conversations/<int:conv_id>", methods=["GET"])
def get_conversation(conv_id):
    """获取单条会话，需登录且为本人。"""
    user_id, err_res = _require_auth()
    if err_res:
        return err_res
    row = db.get_conversation_by_id(conv_id, int(user_id))
    if not row:
        return _err("会话不存在", 404)
    return jsonify(_conv_row_to_json(row))


@app.route("/api/conversations/<int:conv_id>", methods=["PATCH"])
def patch_conversation(conv_id):
    """更新会话 title / pinned，需登录且为本人。"""
    user_id, err_res = _require_auth()
    if err_res:
        return err_res
    data = request.get_json(force=True, silent=True) or {}
    title = data.get("title")
    pinned = data.get("pinned")
    if title is None and pinned is None:
        return jsonify(_conv_row_to_json(db.get_conversation_by_id(conv_id, int(user_id))))
    ok = db.update_conversation(conv_id, int(user_id), title=title, pinned=pinned)
    if not ok:
        return _err("会话不存在", 404)
    row = db.get_conversation_by_id(conv_id, int(user_id))
    return jsonify(_conv_row_to_json(row))


@app.route("/api/conversations/<int:conv_id>", methods=["DELETE"])
def delete_conversation(conv_id):
    """删除会话，需登录且为本人。"""
    user_id, err_res = _require_auth()
    if err_res:
        return err_res
    ok = db.delete_conversation(conv_id, int(user_id))
    if not ok:
        return _err("会话不存在", 404)
    return jsonify({"ok": True})


@app.route("/api/conversations/<int:conv_id>/messages", methods=["GET"])
def list_messages(conv_id):
    """会话消息列表，需登录且为本人。"""
    user_id, err_res = _require_auth()
    if err_res:
        return err_res
    conv = db.get_conversation_by_id(conv_id, int(user_id))
    if not conv:
        return _err("会话不存在", 404)
    limit = request.args.get("limit", type=int) or 500
    limit = min(max(1, limit), 1000)
    rows = db.get_messages_by_conversation(conv_id, limit=limit)
    return jsonify([_msg_row_to_json(r) for r in rows])


@app.route("/api/chat/stream", methods=["POST"])
def chat_stream():
    """
    流式对话：需登录。请求体需含 conversationId；支持 content、imageUrl、attachmentHint。
    会将会话与消息写入数据库，历史从数据库读取。
    响应为 SSE：data: {"content": "增量文本"}，结束 data: [DONE] 或 data: {"type":"done"}。
    """
    user_id, err_res = _require_auth()
    if err_res:
        return err_res
    try:
        data = request.get_json(force=True, silent=True) or {}
        conv_id_raw = data.get("conversationId") or data.get("conversation_id")
        if conv_id_raw is None:
            return jsonify({"error": "缺少 conversationId"}), 400
        try:
            conv_id = int(conv_id_raw)
        except (TypeError, ValueError):
            return jsonify({"error": "conversationId 无效"}), 400
        owner = db.get_conversation_owner(conv_id)
        if owner is None or owner != int(user_id):
            return jsonify({"error": "会话不存在或无权访问"}), 404

        content = (data.get("content") or "").strip()
        attachment_hint = (data.get("attachmentHint") or data.get("attachment_hint") or "").strip()
        image_b64, image_mime = _resolve_image_from_request(data)
        if not content and not attachment_hint and not image_b64:
            return jsonify({"error": "content 或附件不能为空"}), 400
        if attachment_hint and not content:
            content = attachment_hint

        # 从数据库取历史（仅文本，用于上下文）
        history_rows = db.get_messages_by_conversation(conv_id, limit=50)
        history = []
        for r in history_rows:
            role = (r.get("role") or "user").strip()
            if role in ("user", "assistant"):
                history.append({"role": role, "content": (r.get("content") or "").strip()})
        messages_for_ai = build_messages(history, content, image_b64, image_mime)

        # 写入用户消息
        user_content = content or (attachment_hint or "[图片/附件]")
        user_msg_id = db.create_message(conv_id, "user", user_content, "text", None, None)
        db.update_conversation_last_message(conv_id, user_content)

        payload = {
            "model": CHAT_MODEL,
            "messages": messages_for_ai,
            "max_tokens": MAX_TOKENS,
            "stream": True,
        }
        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {API_KEY}",
        }

        def generate():
            full_content = []
            try:
                resp = requests.post(
                    CHAT_API_URL, json=payload, headers=headers, timeout=60, stream=True
                )
                resp.raise_for_status()
                for line in resp.iter_lines(decode_unicode=True):
                    if not line or not line.strip():
                        continue
                    raw = line[6:].strip() if line.startswith("data: ") else line.strip()
                    if raw == "[DONE]":
                        break
                    try:
                        obj = json.loads(raw)
                        delta = (
                            obj.get("choices", [{}])[0]
                            .get("delta", {})
                            .get("content", "")
                        )
                        if delta:
                            full_content.append(delta)
                            yield f"data: {json.dumps({'content': delta}, ensure_ascii=False)}\n\n"
                    except (json.JSONDecodeError, IndexError, KeyError, TypeError):
                        pass
                # 流结束后写入 assistant 消息并更新会话摘要
                ai_content = "".join(full_content).strip() or "（无回复）"
                db.create_message(conv_id, "assistant", ai_content, "text", None, None)
                db.update_conversation_last_message(conv_id, ai_content)
                yield "data: [DONE]\n\n"
            except requests.RequestException as e:
                err = str(e)
                if hasattr(e, "response") and e.response is not None:
                    try:
                        err = (e.response.json() or {}).get("error", {}).get("message", err)
                    except Exception:
                        err = getattr(e.response, "text", None) or err
                yield f"data: {json.dumps({'error': err}, ensure_ascii=False)}\n\n"

        return Response(
            generate(),
            mimetype="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "X-Accel-Buffering": "no",
                "Connection": "keep-alive",
            },
        )
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
