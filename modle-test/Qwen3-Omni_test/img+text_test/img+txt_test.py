"""该测试代码展示了如何使用OpenAI Python SDK调用qwen3-omni-flash-2025-12-01模型，输入图像和文本，获取文本和音频输出。请确保已安装相关库，并正确配置了API Key。"""
import os
import base64
import soundfile as sf
import numpy as np
from openai import OpenAI

client = OpenAI(
    # 若没有配置环境变量，请用阿里云百炼API Key将下行替换为：api_key="sk-xxx",
    # 新加坡和北京地域的API Key不同。获取API Key：https://help.aliyun.com/zh/model-studio/get-api-key
    api_key=os.getenv("DASHSCOPE_API_KEY"),
    # 以下是北京地域base_url，如果使用新加坡地域的模型，需要将base_url替换为：https://dashscope-intl.aliyuncs.com/compatible-mode/v1
    base_url="https://dashscope.aliyuncs.com/compatible-mode/v1",
)

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
                        "type": "image_url",
                        "image_url": {
                            "url": "https://tse1.mm.bing.net/th/id/OIP.Z_Nto-P-NpT1a9yg9vQFrAHaHa?rs=1&pid=ImgDetMain&o=7&rm=3"
                        },
                    },
                    {"type": "text", "text": "这张图片展示了什么？"},
                ],
            },
        ],
        # 设置输出数据的模态，当前支持两种：["text","audio"]、["text"]
        modalities=["text", "audio"],
        audio={"voice": "Cherry", "format": "wav"},
        # stream 必须设置为 True，否则会报错
        stream=True,
        stream_options={
            "include_usage": True
        }
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