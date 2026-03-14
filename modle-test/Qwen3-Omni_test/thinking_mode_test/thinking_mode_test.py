"""该测试代码展示了如何使用OpenAI Python SDK调用qwen3-omni-flash-2025-12-01模型，输入文本，获取思考后输出。请确保已安装相关库，并正确配置了API Key。"""
import os
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
        model="qwen3-omni-flash-2025-12-01",
        messages=[
            {
                "role": "system",
                "content": "你是同学们的好朋友小Q。你的聊天对象是在校学生，像和朋友聊天一样进行回答，回答时语气简短，自然。不要分条列回答"
            },
            {
                "role": "user",
                "content": "你好，请问你是？"
            }
        ],
        
        # 开启/关闭思考模式，在思考模式下不支持输出音频；qwen-omni-turbo不支持设置enable_thinking。   
        extra_body={'enable_thinking': True},
        
        # 设置输出数据的模态，非思考模式下当前支持两种：["text","audio"]、["text"]，思考模式仅支持：["text"]
        modalities=["text"],
        
        # 设置音色，思考模式下不支持设置audio参数
        # audio={"voice": "Cherry", "format": "wav"},
        # stream 必须设置为 True，否则会报错
        stream=True,
        stream_options={"include_usage": True},
    )

    # for chunk in completion:
    #     if chunk.choices:
    #         print(chunk.choices[0].delta)
    #     else:
    #         print(chunk.usage)
            
    #处理流式响应
    print("模型回复：")
    audio_base64_string = ""
    for chunk in completion:
        # 处理文本部分
        if chunk.choices and chunk.choices[0].delta.content:
            print(chunk.choices[0].delta.content, end="")
            
except Exception as e:
    print(f"请求失败: {e}")