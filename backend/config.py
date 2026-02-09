# 大模型 API 配置（阿里云 DashScope 兼容模式）
# MySQL 数据库配置（emo_system）
import os

# 数据库：生产环境请用环境变量覆盖密码
MYSQL_HOST = os.environ.get("MYSQL_HOST", "localhost")
MYSQL_PORT = int(os.environ.get("MYSQL_PORT", "3306"))
MYSQL_DATABASE = os.environ.get("MYSQL_DATABASE", "emo_system")
MYSQL_USER = os.environ.get("MYSQL_USER", "emo_system")
MYSQL_PASSWORD = os.environ.get("MYSQL_PASSWORD", "2bpWJt4mBGCJpGkm")

# 用于生成/验证 token（生产环境请用环境变量设置随机字符串）
SECRET_KEY = os.environ.get("SECRET_KEY", "emo-system-secret-change-in-production")

# 阿里云 DashScope 兼容模式
CHAT_API_URL = os.environ.get(
    "CHAT_API_URL",
    "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions",
)
API_KEY = os.environ.get("CHAT_API_KEY", "sk-aaf9a0809a574079b4453a54619ddd83")
CHAT_MODEL = os.environ.get("CHAT_MODEL", "qwen3-omni-flash")
MAX_TOKENS = int(os.environ.get("CHAT_MAX_TOKENS", "1024"))
