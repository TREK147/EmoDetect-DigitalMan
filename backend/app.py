"""
后端 API：为 frontend 提供 AI 对话、注册登录、文件上传等接口。
"""
import base64
import json
import os
import secrets
import uuid
import requests
import websocket
from flask import Flask, request, jsonify, Response, send_from_directory
from flask_cors import CORS
from werkzeug.exceptions import RequestEntityTooLarge
from werkzeug.security import generate_password_hash, check_password_hash
from werkzeug.utils import secure_filename

from config import (
    CHAT_API_URL,
    API_KEY,
    CHAT_MODEL,
    MAX_TOKENS,
    REALTIME_WS_URL,
    REALTIME_API_KEY,
    REALTIME_MODEL,
    DOUBAO_TTS_APP_ID,
    DOUBAO_TTS_ACCESS_TOKEN,
    DOUBAO_TTS_CLUSTER,
    DOUBAO_TTS_URL,
    DOUBAO_TTS_RESOURCE_ID,
    DOUBAO_TTS_DEFAULT_VOICE,
)
import database as db

# 情绪异常判定阈值：最近 N 天内达到此次数则创建「主动疏导」触发
PROACTIVE_ANOMALY_THRESHOLD = 3
PROACTIVE_ANOMALY_DAYS = 7

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


def _extract_schedules_from_text(user_id: int, text: str) -> list:
    """从用户一句话中抽取日程（如「明天去见孙老师」），写入 user_schedules。"""
    if not (text or "").strip():
        return []
    text = (text or "").strip()[:1500]
    created = []
    from datetime import datetime, timedelta
    today = datetime.now()
    today_str = today.strftime("%Y-%m-%d")
    tomorrow_str = (today + timedelta(days=1)).strftime("%Y-%m-%d")
    if API_KEY:
        try:
            system = f"""当前日期：{today_str}。你只输出一个 JSON 数组，不要 markdown 或其它文字。
从用户这句话里提取明确的日程/待办（某天要做的事、见谁、开会等）。每个元素：{{"title":"事项简述","scheduled_at":"YYYY-MM-DD HH:MM:SS"}}。
时间推断：明天={tomorrow_str} 10:00:00，后天=+2天，大后天=+3天；未说具体时间则用当天 10:00:00。没有明确日程则输出 []。"""
            payload = {
                "model": CHAT_MODEL,
                "messages": [{"role": "system", "content": system}, {"role": "user", "content": text}],
                "max_tokens": 500,
                "stream": False,
            }
            headers = {"Content-Type": "application/json", "Authorization": f"Bearer {API_KEY}"}
            r = requests.post(CHAT_API_URL, json=payload, headers=headers, timeout=15)
            if r.status_code == 200:
                out = r.json()
                text_out = (out.get("choices", [{}])[0].get("message", {}).get("content") or "").strip()
                for raw in (text_out, text_out.replace("```json", "").replace("```", "").strip()):
                    try:
                        parsed = json.loads(raw)
                        arr = parsed if isinstance(parsed, list) else []
                        for item in arr:
                            if isinstance(item, dict) and item.get("title") and item.get("scheduled_at"):
                                st = (item.get("scheduled_at") or "").replace("T", " ").strip()[:19]
                                if len(st) >= 16:
                                    sid = db.create_schedule(int(user_id), title=(item.get("title") or "").strip()[:500], scheduled_at=st, source="conversation", raw_text=text[:500])
                                    created.append({"id": sid, "title": item.get("title"), "scheduled_at": st})
                        if created:
                            return created
                        break
                    except (json.JSONDecodeError, TypeError):
                        continue
        except Exception:
            pass
    for day_offset, kw in [(1, "明天"), (2, "后天"), (3, "大后天")]:
        if kw in text:
            day = (today + timedelta(days=day_offset)).strftime("%Y-%m-%d")
            title = text.replace(kw, "").strip().replace("要去", "").replace("去", "").replace("和", "、").strip()
            if not title or len(title) < 2:
                title = f"待办（{day}）"
            scheduled_at = f"{day} 10:00:00"
            try:
                sid = db.create_schedule(int(user_id), title=title[:500], scheduled_at=scheduled_at, source="conversation", raw_text=text[:500])
                created.append({"id": sid, "title": title, "scheduled_at": scheduled_at})
            except Exception:
                pass
            return created
    return created


def _detect_emotion_anomaly(user_id: int, user_text: str) -> None:
    """用模型判断用户输入是否情绪异常，若异常则写入 emotion_anomalies 并检查是否触发主动疏导。"""
    if not (user_text or "").strip() or not API_KEY:
        return
    try:
        payload = {
            "model": CHAT_MODEL,
            "messages": [
                {"role": "system", "content": "你只输出一段 JSON，不要其他内容。判断用户这句话是否表现出明显情绪异常（如焦虑、抑郁、愤怒、崩溃等）。若异常则输出：{\"is_abnormal\":true,\"emotion_label\":\"异常类型\",\"reason\":\"简短原因\"}；否则输出：{\"is_abnormal\":false}。"},
                {"role": "user", "content": (user_text or "")[:1500]},
            ],
            "max_tokens": 200,
            "stream": False,
        }
        headers = {"Content-Type": "application/json", "Authorization": f"Bearer {API_KEY}"}
        r = requests.post(CHAT_API_URL, json=payload, headers=headers, timeout=15)
        if r.status_code != 200:
            return
        out = r.json()
        text = (out.get("choices", [{}])[0].get("message", {}).get("content") or "").strip()
        if not text:
            return
        for raw in (text, text.replace("```json", "").replace("```", "").strip()):
            try:
                obj = json.loads(raw)
                if obj.get("is_abnormal") and obj.get("emotion_label"):
                    db.add_emotion_anomaly(
                        int(user_id),
                        (obj.get("emotion_label") or "异常")[:64],
                        reason=(obj.get("reason") or "")[:2000],
                        from_monitoring=0,
                    )
                    n = db.count_recent_anomalies(int(user_id), days=PROACTIVE_ANOMALY_DAYS)
                    if n >= PROACTIVE_ANOMALY_THRESHOLD:
                        db.create_proactive_trigger(int(user_id), "repeated_anomaly")
                break
            except (json.JSONDecodeError, TypeError):
                continue
    except Exception:
        pass


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
                # 流结束后写入 assistant 消息并更新会话摘要；从用户输入中抽取日程并写入
                ai_content = "".join(full_content).strip() or "（无回复）"
                db.create_message(conv_id, "assistant", ai_content, "text", None, None)
                db.update_conversation_last_message(conv_id, ai_content)
                _detect_emotion_anomaly(int(user_id), user_content)
                _extract_schedules_from_text(int(user_id), user_content)
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


# ---------- 情绪异常与主动疏导（个人中心情感曲线、事件记录、主动疏导入口） ----------


def _anomaly_row_to_json(row):
    if not row:
        return None
    from_mon = 1 if row.get("from_monitoring") else 0
    return {
        "id": row["id"],
        "user_id": row["user_id"],
        "emotion_label": row["emotion_label"],
        "reason": (row.get("reason") or "").strip(),
        "from_monitoring": from_mon,
        "created_at": row["created_at"].isoformat() if hasattr(row.get("created_at"), "isoformat") else str(row.get("created_at", "")),
    }


@app.route("/api/emotion/anomaly", methods=["POST"])
def emotion_anomaly_add():
    """记录一条情绪异常（聊天或监控写入）。body: { emotion_label, reason?, from_monitoring? }。from_monitoring: 0=聊天（可带 reason），1=监控。为 1 时创建主动疏导触发。"""
    user_id, err_res = _require_auth()
    if err_res:
        return err_res
    data = request.get_json(force=True, silent=True) or {}
    label = (data.get("emotion_label") or data.get("label") or "").strip()
    if not label:
        return _err("请输入情绪标签")
    reason = (data.get("reason") or "").strip()[:2000]
    from_monitoring = 0
    if data.get("from_monitoring") in (1, "1", True):
        from_monitoring = 1
    elif (data.get("source") or "").strip().lower() == "monitoring":
        from_monitoring = 1
    try:
        aid = db.add_emotion_anomaly(int(user_id), label, reason=reason, from_monitoring=from_monitoring)
        if from_monitoring == 1:
            db.create_proactive_trigger(int(user_id), "monitoring")
        row = db.get_emotion_anomalies_by_user(int(user_id), limit=1)
        return jsonify(_anomaly_row_to_json(row[0]) if row else {"id": aid, "emotion_label": label, "reason": reason, "from_monitoring": from_monitoring})
    except Exception as e:
        return _err("保存失败: " + str(e), 500)


@app.route("/api/emotion/anomalies", methods=["GET"])
def emotion_anomalies_list():
    """当前用户情绪异常列表，供个人中心与模型检索。query: limit, since_days"""
    user_id, err_res = _require_auth()
    if err_res:
        return err_res
    try:
        limit = request.args.get("limit", type=int) or 100
        since_days = request.args.get("since_days", type=int)
        rows = db.get_emotion_anomalies_by_user(int(user_id), limit=min(max(1, limit), 500), since_days=since_days)
        return jsonify([_anomaly_row_to_json(r) for r in rows])
    except Exception as e:
        return _err("查询失败: " + str(e), 500)


@app.route("/api/emotion/stats", methods=["GET"])
def emotion_stats():
    """情绪统计：按日聚合数量，供可视化情感曲线。query: days 默认 30"""
    user_id, err_res = _require_auth()
    if err_res:
        return err_res
    try:
        days = min(max(1, request.args.get("days", type=int) or 30), 365)
        rows = db.get_emotion_stats_by_user(int(user_id), days=days)
        return jsonify(rows)
    except Exception as e:
        return _err("查询失败: " + str(e), 500)


@app.route("/api/proactive/pending", methods=["GET"])
def proactive_pending():
    """当前用户是否有待响应的主动疏导（监控检测到异常 / 多次异常）。"""
    user_id, err_res = _require_auth()
    if err_res:
        return err_res
    try:
        row = db.get_pending_proactive_trigger(int(user_id))
        if not row:
            return jsonify(None)
        return jsonify({
            "id": row["id"],
            "trigger_type": row["trigger_type"],
            "created_at": row["created_at"].isoformat() if hasattr(row.get("created_at"), "isoformat") else str(row.get("created_at", "")),
        })
    except Exception as e:
        return _err("查询失败: " + str(e), 500)


@app.route("/api/proactive/ack", methods=["POST"])
def proactive_ack():
    """用户点击「去聊天」后确认已响应。body: { triggerId }"""
    user_id, err_res = _require_auth()
    if err_res:
        return err_res
    data = request.get_json(force=True, silent=True) or {}
    tid = data.get("triggerId") or data.get("trigger_id")
    if tid is None:
        return _err("缺少 triggerId")
    try:
        ok = db.acknowledge_proactive_trigger(int(tid), int(user_id))
        return jsonify({"ok": ok})
    except Exception as e:
        return _err("操作失败: " + str(e), 500)


# ---------- 日程（个人中心用） ----------


def _schedule_row_to_json(row):
    if not row:
        return None
    return {
        "id": row["id"],
        "user_id": row["user_id"],
        "title": row["title"],
        "scheduled_at": row["scheduled_at"].isoformat() if hasattr(row.get("scheduled_at"), "isoformat") else str(row.get("scheduled_at", "")),
        "end_at": row["end_at"].isoformat() if row.get("end_at") and hasattr(row["end_at"], "isoformat") else (str(row["end_at"]) if row.get("end_at") else None),
        "source": (row.get("source") or "conversation").strip(),
        "raw_text": (row.get("raw_text") or "").strip() or None,
        "status": (row.get("status") or "pending").strip(),
        "created_at": row["created_at"].isoformat() if hasattr(row.get("created_at"), "isoformat") else str(row.get("created_at", "")),
    }


@app.route("/api/schedules", methods=["GET"])
def schedules_list():
    user_id, err_res = _require_auth()
    if err_res:
        return err_res
    try:
        start_date = request.args.get("startDate") or request.args.get("start_date")
        end_date = request.args.get("endDate") or request.args.get("end_date")
        rows = db.get_schedules_by_user(int(user_id), start_date=start_date, end_date=end_date)
        return jsonify([_schedule_row_to_json(r) for r in rows])
    except Exception as e:
        return _err("查询失败: " + str(e), 500)


@app.route("/api/schedules", methods=["POST"])
def schedules_create():
    user_id, err_res = _require_auth()
    if err_res:
        return err_res
    data = request.get_json(force=True, silent=True) or {}
    title = (data.get("title") or "").strip()
    scheduled_at = (data.get("scheduled_at") or data.get("scheduledAt") or "").strip().replace("T", " ")[:19]
    if not title or not scheduled_at:
        return _err("请填写 title 和 scheduled_at")
    if len(scheduled_at) == 16:
        scheduled_at = scheduled_at + ":00"
    try:
        end_at = (data.get("end_at") or data.get("endAt") or "").strip().replace("T", " ")[:19] or None
        sid = db.create_schedule(int(user_id), title, scheduled_at, end_at=end_at, source="manual")
        row = db.get_schedule_by_id(sid, int(user_id))
        return jsonify(_schedule_row_to_json(row))
    except Exception as e:
        return _err("创建失败: " + str(e), 500)


@app.route("/api/schedules/<int:schedule_id>", methods=["PATCH"])
def schedule_patch(schedule_id):
    user_id, err_res = _require_auth()
    if err_res:
        return err_res
    data = request.get_json(force=True, silent=True) or {}
    updates = {}
    if "title" in data:
        updates["title"] = (data.get("title") or "").strip()
    if "scheduled_at" in data or "scheduledAt" in data:
        raw = (data.get("scheduled_at") or data.get("scheduledAt") or "").strip().replace("T", " ")[:19]
        if len(raw) == 16:
            raw = raw + ":00"
        updates["scheduled_at"] = raw
    if "end_at" in data or "endAt" in data:
        raw = (data.get("end_at") or data.get("endAt") or "").strip().replace("T", " ")[:19] or None
        if raw and len(raw) == 16:
            raw = raw + ":00"
        updates["end_at"] = raw
    if "status" in data:
        updates["status"] = (data.get("status") or "pending").strip()[:20]
    if not updates:
        row = db.get_schedule_by_id(schedule_id, int(user_id))
        if not row:
            return _err("日程不存在", 404)
        return jsonify(_schedule_row_to_json(row))
    ok = db.update_schedule(schedule_id, int(user_id), **updates)
    if not ok:
        return _err("日程不存在", 404)
    row = db.get_schedule_by_id(schedule_id, int(user_id))
    return jsonify(_schedule_row_to_json(row))


@app.route("/api/schedules/<int:schedule_id>", methods=["DELETE"])
def schedule_delete(schedule_id):
    user_id, err_res = _require_auth()
    if err_res:
        return err_res
    ok = db.delete_schedule(schedule_id, int(user_id))
    if not ok:
        return _err("日程不存在", 404)
    return jsonify({"ok": True})


# ---------- 实时对话（DashScope Realtime：语音入 -> 文本+语音出，与聊天框同步） ----------

_REALTIME_CHUNK_BYTES = 3200  # 100ms @ 16k 16bit mono


def _realtime_stream(conv_id, user_id, pcm_base64):
    """连接 DashScope Realtime，发送 PCM 音频，流式返回文本与音频。"""
    url = f"{REALTIME_WS_URL.rstrip('/')}?model={REALTIME_MODEL}"
    headers = [f"Authorization: Bearer {REALTIME_API_KEY}"]
    full_transcript = []
    try:
        ws = websocket.create_connection(url, header=headers, timeout=30)
    except Exception as e:
        yield f"data: {json.dumps({'error': str(e)}, ensure_ascii=False)}\n\n"
        return
    try:
        # session.update：modalities 顺序需为 ['audio','text']（文档要求），仅输出文本+音频，不启用 VAD
        session_event = {
            "type": "session.update",
            "event_id": f"evt_{uuid.uuid4().hex[:24]}",
            "session": {
                "modalities": ["audio", "text"],
                "voice": "Cherry",
                "input_audio_format": "pcm16",
                "output_audio_format": "pcm24",
                "input_audio_transcription": {"model": "gummy-realtime-v1"},
                "turn_detection": None,
                "instructions": "你是智慧星数字人助手，请简洁友好地回复。",
            },
        }
        ws.send(json.dumps(session_event, ensure_ascii=False))
        # 等待 session.updated 后再发音频（可能先收到 session.created）
        while True:
            first = ws.recv()
            if not first:
                break
            try:
                ev = json.loads(first)
                typ = ev.get("type") or ""
                if typ == "error":
                    err = ev.get("error") or {}
                    msg = err.get("message") or ev.get("message") or str(ev.get("code", "unknown"))
                    yield f"data: {json.dumps({'error': msg}, ensure_ascii=False)}\n\n"
                    return
                if typ == "session.updated":
                    break
            except json.JSONDecodeError:
                break

        # 发送 PCM：按 3200 字节一块 append
        pcm_bytes = base64.b64decode(pcm_base64)
        for i in range(0, len(pcm_bytes), _REALTIME_CHUNK_BYTES):
            chunk = pcm_bytes[i : i + _REALTIME_CHUNK_BYTES]
            b64_chunk = base64.b64encode(chunk).decode("ascii")
            ws.send(json.dumps({
                "type": "input_audio_buffer.append",
                "event_id": f"evt_{uuid.uuid4().hex[:24]}",
                "audio": b64_chunk,
            }, ensure_ascii=False))

        ws.send(json.dumps({
            "type": "input_audio_buffer.commit",
            "event_id": f"evt_{uuid.uuid4().hex[:24]}",
        }, ensure_ascii=False))

        ws.send(json.dumps({
            "type": "response.create",
            "event_id": f"evt_{uuid.uuid4().hex[:24]}",
        }, ensure_ascii=False))

        while True:
            msg = ws.recv()
            if not msg:
                break
            try:
                ev = json.loads(msg)
            except json.JSONDecodeError:
                continue
            typ = ev.get("type") or ""
            if typ == "response.audio_transcript.delta":
                delta = (ev.get("delta") or "").strip()
                if delta:
                    full_transcript.append(delta)
                    yield f"data: {json.dumps({'content': delta}, ensure_ascii=False)}\n\n"
            elif typ == "response.audio.delta":
                delta_b64 = ev.get("delta") or ""
                if delta_b64:
                    yield f"data: {json.dumps({'audio': delta_b64}, ensure_ascii=False)}\n\n"
            elif typ == "error":
                err = ev.get("error") or {}
                msg = err.get("message") or ev.get("message") or str(ev.get("code", "unknown"))
                yield f"data: {json.dumps({'error': msg}, ensure_ascii=False)}\n\n"
                break
            elif typ == "response.done":
                break
        ai_content = "".join(full_transcript).strip() or "（无回复）"
        db.create_message(conv_id, "assistant", ai_content, "text", None, None)
        db.update_conversation_last_message(conv_id, ai_content)
        yield "data: [DONE]\n\n"
    except Exception as e:
        yield f"data: {json.dumps({'error': str(e)}, ensure_ascii=False)}\n\n"
    finally:
        try:
            ws.close()
        except Exception:
            pass


@app.route("/api/chat/realtime", methods=["POST"])
def chat_realtime():
    """
    实时语音对话：请求体需 conversationId、pcmBase64（16k 16bit 单声道 PCM 的 base64）。
    返回 SSE：data: {"content": "文本片段"} 或 data: {"audio": "base64"}，结束 data: [DONE]。
    仅当「点击数字人」开启语音时，前端发送语音消息走此接口，实现文字与语音同步输出。
    """
    user_id, err_res = _require_auth()
    if err_res:
        return err_res
    try:
        data = request.get_json(force=True, silent=True) or {}
        conv_id_raw = data.get("conversationId") or data.get("conversation_id")
        pcm_base64 = (data.get("pcmBase64") or "").strip()
        if conv_id_raw is None:
            return jsonify({"error": "缺少 conversationId"}), 400
        if not pcm_base64:
            return jsonify({"error": "缺少 pcmBase64（16k 16bit 单声道 PCM 的 base64）"}), 400
        try:
            conv_id = int(conv_id_raw)
        except (TypeError, ValueError):
            return jsonify({"error": "conversationId 无效"}), 400
        owner = db.get_conversation_owner(conv_id)
        if owner is None or owner != int(user_id):
            return jsonify({"error": "会话不存在或无权访问"}), 404

        user_content = "[语音]"
        db.create_message(conv_id, "user", user_content, "voice", None, None)
        db.update_conversation_last_message(conv_id, user_content)

        return Response(
            _realtime_stream(conv_id, user_id, pcm_base64),
            mimetype="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "X-Accel-Buffering": "no",
                "Connection": "keep-alive",
            },
        )
    except Exception as e:
        return jsonify({"error": str(e)}), 500


# ---------- 豆包 TTS 语音合成（数字人发声） ----------


@app.route("/api/tts", methods=["POST"])
def tts():
    """
    文本转语音，调用豆包语音合成大模型 HTTP V1 接口。
    请求体: { "text": "要合成的文本" }，返回 mp3 音频字节。
    """
    try:
        data = request.get_json(force=True, silent=True) or {}
        text = (data.get("text") or "").strip()
        if not text:
            return jsonify({"error": "缺少 text 参数"}), 400
        if len(text.encode("utf-8")) > 1024:
            return jsonify({"error": "文本过长，最长支持约 1000 字节"}), 400

        speed = float(data.get("speed_ratio", 1.0) or 1.0)
        speed = max(0.1, min(2.0, speed))

        payload = {
            "app": {
                "appid": DOUBAO_TTS_APP_ID,
                "token": DOUBAO_TTS_ACCESS_TOKEN,
                "cluster": DOUBAO_TTS_CLUSTER or "volcano_tts",
            },
            "user": {"uid": "wisdom-star"},
            "audio": {
                "voice_type": data.get("voice_type") or DOUBAO_TTS_DEFAULT_VOICE,
                "encoding": "mp3",
                "speed_ratio": speed,
                "volume_ratio": 1.0,
            },
            "request": {
                "reqid": str(uuid.uuid4()),
                "text": text,
                "operation": "query",
            },
        }
        if DOUBAO_TTS_RESOURCE_ID:
            payload["request"]["model"] = DOUBAO_TTS_RESOURCE_ID
        headers = {
            "Content-Type": "application/json",
            "Accept": "application/json",
            "Authorization": f"Bearer;{DOUBAO_TTS_ACCESS_TOKEN}",
        }
        if DOUBAO_TTS_RESOURCE_ID:
            headers["X-Api-Resource-Id"] = DOUBAO_TTS_RESOURCE_ID
        resp = requests.post(
            DOUBAO_TTS_URL,
            json=payload,
            headers=headers,
            timeout=15,
        )
        resp.raise_for_status()
        result = resp.json()
        code = result.get("code", 0)
        if code != 3000:
            msg = result.get("message") or f"code={code}"
            return jsonify({"error": f"TTS 合成失败: {msg}"}), 502
        b64_data = result.get("data") or ""
        if not b64_data:
            return jsonify({"error": "TTS 返回音频为空"}), 502
        audio_bytes = base64.b64decode(b64_data)
        return Response(audio_bytes, mimetype="audio/mpeg")
    except requests.RequestException as e:
        err = str(e)
        if hasattr(e, "response") and e.response is not None:
            try:
                j = e.response.json()
                err = j.get("message") or j.get("error") or err
            except Exception:
                err = (getattr(e.response, "text", None) or err)[:300]
        return jsonify({"error": f"TTS 请求失败: {err}"}), 502
    except Exception as e:
        return jsonify({"error": str(e)}), 500


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
