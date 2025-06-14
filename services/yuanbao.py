import json
from typing import Dict, List

from openai import OpenAI

from schemas.config import YuanBaoConfig


class YuanBaoClient:

    def __init__(self, config: YuanBaoConfig):
        self.client = OpenAI(base_url=config.base_url, api_key=config.api_key)
        self.model = config.model
        self.extra_body = {
            "hy_source": "web",
            "hy_user": config.hy_user,
            "agent_id": config.agent_id,
            "chat_id": config.chat_id,
            "should_remove_conversation": config.should_remove_conversation,
        }
        self.should_sleep = False

    async def get_response(self, messages: List[Dict[str, str]]) -> str:
        response = self.client.chat.completions.create(
            model=self.model,
            messages=messages,
            stream=True,
            extra_body=self.extra_body,
        )

        text = ""
        for chunk in response:
            content = chunk.choices[0].delta.content
            try:
                data = json.loads(content)
                if data.get("type") == "text":
                    text += data.get("msg", "")
            except json.JSONDecodeError:
                pass
        return text
