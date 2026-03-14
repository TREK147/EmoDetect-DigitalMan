"""该测试代码展示了如何使用OpenAI Python SDK调用qwen3-omni-flash-2025-12-01模型，多轮输入文本，获取文本输出。请确保已安装相关库，并正确配置了API Key。"""
import os
import base64
import soundfile as sf
import numpy as np
from openai import OpenAI

# 1. 初始化客户端
client = OpenAI(
    api_key=os.getenv("DASHSCOPE_API_KEY"),  # 确认已配置环境变量
    base_url="https://dashscope.aliyuncs.com/compatible-mode/v1",
)

# 2. 发起请求
try:
    completion = client.chat.completions.create(
        model="qwen3-omni-flash-2025-12-01", # 模型为Qwen3-Omni-Flash时，请在非思考模式下运行
        messages=[
            {
                "role": "system",
                "content": "你是同学们的好朋友小Q。你的聊天对象是在校学生，像和朋友聊天一样进行回答，回答时语气简短，自然。"
            },
            {
                "role": "user",
                "content": [
                    {
                        "type": "input_audio",
                        "input_audio": {
                            "data": "https://dashscope.oss-cn-beijing.aliyuncs.com/audios/welcome.mp3",
                            "format": "mp3",
                        },
                    },
                    {"type": "text", "text": "这段音频在说什么"},
                ],
            },
            {
                "role": "assistant",
                "content": [{"type": "text", "text": "这段音频在说：欢迎使用阿里云"}],
            },
            {
                "role": "user",
                "content": [{"type": "text", "text": "介绍一下这家公司？"}],
            },
        ],
        # 设置输出数据的模态，当前支持两种：["text","audio"]、["text"]
        modalities=["text"],
        # stream 必须设置为 True，否则会报错
        stream=True,
        stream_options={"include_usage": True},
    )

    # 3. 处理流式响应
    print("模型回复：")
    for chunk in completion:
        # 处理文本部分
        if chunk.choices and chunk.choices[0].delta.content:
            print(chunk.choices[0].delta.content, end="")

except Exception as e:
    print(f"请求失败: {e}")