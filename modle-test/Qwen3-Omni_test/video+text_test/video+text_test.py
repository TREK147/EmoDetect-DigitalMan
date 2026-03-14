"""该测试代码展示了如何使用OpenAI Python SDK调用qwen3-omni-flash-2025-12-01模型，输入视频和文本，获取文本和音频输出。请确保已安装相关库，并正确配置了API Key。"""
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
                        "type": "video",
                        "video": [
                            "https://help-static-aliyun-doc.aliyuncs.com/file-manage-files/zh-CN/20241108/xzsgiz/football1.jpg",
                            "https://help-static-aliyun-doc.aliyuncs.com/file-manage-files/zh-CN/20241108/tdescd/football2.jpg",
                            "https://help-static-aliyun-doc.aliyuncs.com/file-manage-files/zh-CN/20241108/zefdja/football3.jpg",
                            "https://help-static-aliyun-doc.aliyuncs.com/file-manage-files/zh-CN/20241108/aedbqh/football4.jpg",
                        ],
                    },
                    {"type": "text", "text": "描述这个视频的具体过程"},
                ],
            }
        ],
        # 设置输出数据的模态，当前支持两种：["text","audio"]、["text"]
        modalities=["text", "audio"],
        audio={"voice": "Cherry", "format": "wav"},
        # stream 必须设置为 True，否则会报错
        stream=True,
        stream_options={"include_usage": True},
    )

    # 3. 处理流式响应并解码音频
    print("模型回复：")
    audio_base64_string = ""
    for chunk in completion:
        # 处理文本部分
        if chunk.choices and chunk.choices[0].delta.content:
            print(chunk.choices[0].delta.content, end="")

        # 收集音频部分
        if chunk.choices and hasattr(chunk.choices[0].delta, "audio") and chunk.choices[0].delta.audio:
            audio_base64_string += chunk.choices[0].delta.audio.get("data", "")

    # 4. 保存音频文件
    if audio_base64_string:
        wav_bytes = base64.b64decode(audio_base64_string)
        audio_np = np.frombuffer(wav_bytes, dtype=np.int16)
        sf.write("audio_assistant.wav", audio_np, samplerate=24000)
        print("\n音频文件已保存至：audio_assistant.wav")

except Exception as e:
    print(f"请求失败: {e}")