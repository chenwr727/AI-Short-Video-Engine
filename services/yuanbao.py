import re
from typing import Dict, List, Optional, Tuple

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

    def _extract_type(self, text: str) -> Tuple[Optional[str], Optional[str]]:
        match = re.search(r"^\[(.+?)\](.*)", text, re.DOTALL)
        return (match.group(1), match.group(2)) if match else (None, None)

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
            key, value = self._extract_type(content)
            if key == "text":
                text += value
        return text
