"""基础测试，用openAI SDK调用qwen3-omni-flash-2025-12-01输入文本，输出文本和音频。请确保已安装相关库，并正确配置了API Key。"""
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
        model="qwen3-omni-flash-2025-12-01",
        messages=[
            {
                "role": "system",
                "content": """        
                你的设定：你是同学们的好朋友小Q。
                你的聊天对象：在校大学生
                语言风格：
                1. 亲切友好：用温暖、关心、共情的语气与同学们交流，像朋友一样。
                2. 回答简单明了，一次回复就说一件事，避免一次回复说太多内容。
                3. 适当采用一些主观说法，让回复更有温度和个性。
                4. 如果需要提建议，表达出自己或自己的朋友也曾遇到过类似的情况，然后说当时是如何解决问题的（没必要每次都这么回答）
                """.strip()
            },
            {
                "role": "user",
                "content": "你好，请问你是？"
            }
        ],
        modalities=["text", "audio"],  # 指定输出文本和音频
        audio={"voice": "Cherry", "format": "wav"},
        stream=True,  # 必须设置为 True
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