from openai import OpenAI

from utils.log import logger


class LLmWriter:
    def __init__(self, api_key: str, base_url: str, model: str):
        self.api_key = api_key
        self.base_url = base_url
        self.model = model
        self.client = OpenAI(api_key=self.api_key, base_url=self.base_url)

    async def vision_writer(self, image_url: str, question: str, system_prompt: str = "") -> str:
        """Ask a vision-capable model to look at an image and answer a question.

        Uses the same client/model as `writer`; the caller is expected to have
        constructed this writer with a vision-capable model if they intend to use it.
        """
        content = [{"type": "image_url", "image_url": {"url": image_url}}]
        if question:
            content.append({"type": "text", "text": question})
        messages = []
        if system_prompt:
            messages.append({"role": "system", "content": system_prompt})
        messages.append({"role": "user", "content": content})
        try:
            response = self.client.chat.completions.create(
                model=self.model,
                messages=messages,
            )
            if (
                response.choices
                and response.choices[0]
                and response.choices[0].message
                and response.choices[0].message.content
            ):
                return response.choices[0].message.content
            else:
                raise ValueError("Unexpected response format")
        except Exception as e:
            logger.error(f"Vision error: {e}")
            return None

    async def writer(self, content: str, system_prompt: str, **kwargs) -> str:
        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": content},
        ]
        try:
            response = self.client.chat.completions.create(
                model=self.model,
                messages=messages,
                **kwargs,
            )
            if (
                response.choices
                and response.choices[0]
                and response.choices[0].message
                and response.choices[0].message.content
            ):
                return response.choices[0].message.content
            else:
                raise ValueError("Unexpected response format")
        except Exception as e:
            logger.error(f"Error occurred: {e}")
            return None
