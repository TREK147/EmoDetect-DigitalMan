# AutoDL 模型配置（与 connect_test.py 一致）
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

AUTODL_URL = os.environ.get(
    "AUTODL_URL",
    "https://u863554-ae78-309dada8.bjb1.seetacloud.com:8443/v1/chat/completions",
)
API_KEY = os.environ.get("AUTODL_API_KEY", "wyc666")
CHAT_MODEL = os.environ.get("CHAT_MODEL", "Qwen-VL-Chat")
MAX_TOKENS = int(os.environ.get("CHAT_MAX_TOKENS", "1024"))
