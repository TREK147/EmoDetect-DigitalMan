# 大模型 API 配置（阿里云 DashScope 兼容模式）
# MySQL 数据库配置（emo_system）
# 格式：mysql+pymysql://用户名:密码@服务器公网IP:3306/数据库名
import os

try:
    from dotenv import load_dotenv

    _here = os.path.dirname(os.path.abspath(__file__))
    load_dotenv(os.path.join(_here, "..", "..", ".env"))
    load_dotenv(os.path.join(_here, ".env"))
except ImportError:
    pass

# SQLAlchemy 连接 URI（供 Flask-SQLAlchemy 等使用）
SQLALCHEMY_DATABASE_URI = os.environ.get(
    "SQLALCHEMY_DATABASE_URI",
    "mysql+pymysql://root:e1f2340ca88560a0@106.14.184.202:3306/emo_system",
)

# 数据库：默认连本机；宝塔创建的库一般为 emo_system / emo_system，密码以 .env 为准
MYSQL_HOST = os.environ.get("MYSQL_HOST", "127.0.0.1")
MYSQL_PORT = int(os.environ.get("MYSQL_PORT", "3306"))
MYSQL_DATABASE = os.environ.get("MYSQL_DATABASE", "emo_system")
MYSQL_USER = os.environ.get("MYSQL_USER", "emo_system")
MYSQL_PASSWORD = os.environ.get("MYSQL_PASSWORD", "")

# 用于生成/验证 token（生产环境请用环境变量设置随机字符串）
SECRET_KEY = os.environ.get("SECRET_KEY", "emo-system-secret-change-in-production")

# 阿里云 DashScope：文本对话用 HTTP 兼容模式，实时语音用 WebSocket
CHAT_API_URL = os.environ.get(
    "CHAT_API_URL",
    "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions",
)
API_KEY = os.environ.get(
    "CHAT_API_KEY",
    os.environ.get("DASHSCOPE_REALTIME_API_KEY", "sk-b14e4cee630944609d1c2caefe39dc0e"),
)
CHAT_MODEL = os.environ.get("CHAT_MODEL", "qwen3-omni-flash")
MAX_TOKENS = int(os.environ.get("CHAT_MAX_TOKENS", "1024"))

# 实时对话（数字人语音）：WebSocket，与聊天框同步输出文本+语音
REALTIME_WS_URL = os.environ.get(
    "REALTIME_WS_URL",
    "wss://dashscope.aliyuncs.com/api-ws/v1/realtime",
)
REALTIME_API_KEY = os.environ.get(
    "REALTIME_API_KEY",
    "sk-b14e4cee630944609d1c2caefe39dc0e",
)
REALTIME_MODEL = os.environ.get("REALTIME_MODEL", "qwen3-omni-flash-realtime")

# 豆包语音合成 TTS（用于数字人发声）
# 这些值来自你在火山引擎控制台申请的 AppID / Token
DOUBAO_TTS_APP_ID = os.environ.get("DOUBAO_TTS_APP_ID", "6750944620")
DOUBAO_TTS_ACCESS_TOKEN = os.environ.get(
    "DOUBAO_TTS_ACCESS_TOKEN", "hSASGpCZb2Ol_fKNYRqY6hXwJsfPXFQx"
)
DOUBAO_TTS_CLUSTER = os.environ.get("DOUBAO_TTS_CLUSTER", "volcano_tts")
DOUBAO_TTS_URL = os.environ.get(
    "DOUBAO_TTS_URL", "https://openspeech.bytedance.com/api/v1/tts"
)
# 资源 ID：留空 = 使用「语音合成大模型-字符版」默认资源（音色用控制台 *_moon_bigtts）
# 填 "seed-tts-1.0" = 使用 Seed TTS 1.0（需在控制台开通对应资源）
DOUBAO_TTS_RESOURCE_ID = os.environ.get("DOUBAO_TTS_RESOURCE_ID", "")
# 默认音色（控制台「音色详情」里的 Voice_type）
# 可选示例：zh_female_meilinvyou_moon_bigtts 魅力女友, zh_male_haoyuxiaoge_moon_bigtts 浩宇小哥,
# zh_male_shaonianzixin_moon_bigtts 少年梓辛, zh_female_daimengchuanmei_moon_bigtts 呆萌川妹
DOUBAO_TTS_DEFAULT_VOICE = os.environ.get(
    "DOUBAO_TTS_DEFAULT_VOICE", "zh_male_haoyuxiaoge_moon_bigtts"
)
