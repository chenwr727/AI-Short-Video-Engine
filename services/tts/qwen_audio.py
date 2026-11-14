from typing import List, Optional

import dashscope
from dashscope.audio.http_tts.http_speech_synthesizer import HttpSpeechSynthesizer

from .base import TextToSpeechConverter


class QwenAudioTextToSpeechConverter(TextToSpeechConverter):

    def __init__(
        self,
        api_key: str,
        model: str,
        voices: List[str],
        folder: str,
        speed: float = 1.1,
        base_url: Optional[str] = None,
    ):
        self.api_key = api_key
        self.model = model
        if base_url:
            dashscope.base_http_api_url = base_url
        super().__init__(voices, folder, speed)

    async def generate_audio(self, content: str, voice: str, file_name: str):
        tts_text = content

        result = HttpSpeechSynthesizer.call(
            model=self.model,
            text=tts_text,
            voice=voice,
            audio_format="wav",
            sample_rate=24000,
            stream=False,
            api_key=self.api_key,
        )
        if not result or not getattr(result, "audio_url", None):
            raise RuntimeError(
                f"TTS returned no audio (model={self.model}, voice={voice}): "
                f"{getattr(result, 'code', 'unknown')} - {getattr(result, 'message', result)}"
            )

        import requests

        audio = requests.get(result.audio_url, timeout=120)
        audio.raise_for_status()
        with open(file_name, "wb") as f:
            f.write(audio.content)
