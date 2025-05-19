from enum import Enum
from typing import List, Optional

from pydantic import BaseModel


class PromptSource(str, Enum):
    podcast = "podcast"
    crosstalk = "crosstalk"
    talkshow = "talkshow"


class TTSSource(str, Enum):
    dashscope = "dashscope"
    edge = "edge"
    hailuo = "hailuo"
    kokoro = "kokoro"


class MaterialSource(str, Enum):
    pixabay = "pixabay"
    pexels = "pexels"


class LLMConfig(BaseModel):
    api_key: str
    base_url: str
    model: str
    prompt: PromptSource = PromptSource.crosstalk


class YuanBaoConfig(BaseModel):
    base_url: str
    api_key: str
    model: str
    hy_user: str
    agent_id: str
    chat_id: str = ""
    should_remove_conversation: bool = False


class PromptConfig(BaseModel):
    prompt_writer: str = ""
    prompt_reflector: str = ""
    prompt_rewriter: str = ""


class TTSBaseConfig(BaseModel):
    voices: List[str] = []
    speed: float = 1.1


class TTSDashscopeConfig(TTSBaseConfig):
    api_key: str = ""
    model: str = ""


class TTSEdgeConfig(TTSBaseConfig):
    pass


class TTSKokoroConfig(TTSBaseConfig):
    model: str = ""
    config: str = ""
    lang_code: str = ""


class TTSHaiLuoConfig(TTSBaseConfig):
    api_key: str = ""
    base_url: str = ""


class TTSConfig(BaseModel):
    source: TTSSource
    dashscope: Optional[TTSDashscopeConfig] = None
    edge: Optional[TTSEdgeConfig] = None
    hailuo: Optional[TTSHaiLuoConfig] = None
    kokoro: Optional[TTSKokoroConfig] = None


class SubtitleConfig(BaseModel):
    font: str
    width_ratio: float = 0.8
    font_size_ratio: int = 17
    position_ratio: float = 2 / 3
    color: str = "white"
    stroke_color: str = "black"
    stroke_width: int = 1
    text_align: str = "center"
    interval: float = 0.2


class TitleConfig(SubtitleConfig):
    duration: float = 0.5


class VideoConfig(BaseModel):
    fps: int
    background_audio: str
    width: int
    height: int
    title: TitleConfig
    subtitle: SubtitleConfig


class ApiConfig(BaseModel):
    database_url: str
    app_port: int
    max_concurrent_tasks: int
    task_timeout_seconds: int


class MaterialPexelsConfig(BaseModel):
    api_key: str = ""
    locale: str = ""


class MaterialPixabayConfig(BaseModel):
    api_key: str = ""
    lang: str = "zh"
    video_type: str = "all"


class MaterialConfig(BaseModel):
    source: MaterialSource
    minimum_duration: int
    prompt: str
    pexels: Optional[MaterialPexelsConfig] = None
    pixabay: Optional[MaterialPixabayConfig] = None


class Config(BaseModel):
    llm: LLMConfig
    yuanbao: YuanBaoConfig
    prompt: Optional[PromptConfig] = None
    tts: TTSConfig
    video: VideoConfig
    api: ApiConfig
    material: MaterialConfig
