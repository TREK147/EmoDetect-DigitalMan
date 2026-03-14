import os
from openai import OpenAI

# 1. 初始化客户端
client = OpenAI(
    api_key=os.getenv("DASHSCOPE_API_KEY"),
    base_url="https://dashscope.aliyuncs.com/compatible-mode/v1",
)

# 2. 初始化对话记忆
messages = [
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
    }
]

print("===== 小Q聊天开始（输入'退出'以结束对话）=====")

while True:
    user_input = input("\n你：")

    # 退出信号
    if user_input.strip() in ["退出", "exit", "quit"]:
        print("小Q：那下次再聊呀 👋")
        break

    # 把用户输入加入记忆
    messages.append({
        "role": "user",
        "content": user_input
    })

    try:
        completion = client.chat.completions.create(
            model="qwen3-omni-flash-2025-12-01",
            messages=messages,
            modalities=["text"],
            stream=True,
            stream_options={"include_usage": True},
            temperature=0.7,
        )

        print("小Q：", end="")

        assistant_reply = ""

        for chunk in completion:
            if chunk.choices and chunk.choices[0].delta.content:
                delta = chunk.choices[0].delta.content
                print(delta, end="", flush=True)
                assistant_reply += delta

        # 把模型回复加入记忆
        messages.append({
            "role": "assistant",
            "content": assistant_reply
        })

    except Exception as e:
        print(f"\n请求失败: {e}")