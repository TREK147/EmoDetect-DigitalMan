# 大模型 API 配置（阿里云 DashScope 兼容模式）
# MySQL 数据库配置（emo_system）
# 格式：mysql+pymysql://用户名:密码@服务器公网IP:3306/数据库名
import os

# SQLAlchemy 连接 URI（供 Flask-SQLAlchemy 等使用）
SQLALCHEMY_DATABASE_URI = os.environ.get(
    "SQLALCHEMY_DATABASE_URI",
    "mysql+pymysql://root:e1f2340ca88560a0@106.14.184.202:3306/emo_system",
)

# 数据库：生产环境请用环境变量覆盖
MYSQL_HOST = os.environ.get("MYSQL_HOST", "106.14.184.202")
MYSQL_PORT = int(os.environ.get("MYSQL_PORT", "3306"))
MYSQL_DATABASE = os.environ.get("MYSQL_DATABASE", "emo_system")
MYSQL_USER = os.environ.get("MYSQL_USER", "root")
MYSQL_PASSWORD = os.environ.get("MYSQL_PASSWORD", "e1f2340ca88560a0")

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
