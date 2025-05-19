简体中文 | [English](README_EN.md)

<div align="center">
    <h1 style="color: #FF5733;">⚡ CodexReel: 让AI替你拍短视频</h1>
    <p style="color: #3498DB;">🚀 用AI精准打造爆款短视频，文章秒变流量密码</p>
    <p>
        <img src="https://img.shields.io/badge/license-MIT-green" alt="license">
        <img src="https://img.shields.io/github/stars/chenwr727/CodexReel" alt="stars">
        <img src="https://img.shields.io/github/forks/chenwr727/CodexReel" alt="forks">
    </p>
</div>

## 📖 项目介绍

CodexReel 是一个基于 AI 的智能视频生成平台，能够将多种输入内容（如文章链接、文案主题文本（支持联网搜索））一键转化为高质量、富有表现力的互动式视频内容。借助先进的多模态大语言模型（LLM）技术，我们让内容创作变得更简单、更高效、更具传播力。

无论是新闻资讯、科技文章、公众号推文，还是用户自定义的主题内容，只需提供 URL、文本主题，CodexReel 即可自动完成内容理解、脚本生成、素材匹配、语音合成与视频剪辑，输出可用于社交平台发布的专业级短视频。

- 搜索功能来源于 [yuanbao-free-api](https://github.com/chenwr727/yuanbao-free-api.git) 

### ✨ 核心功能

| 功能模块              | 描述说明 |
|-----------------------|----------|
| 🤖 智能内容理解       | 自动提取文章核心信息，生成结构化脚本 |
| 🎭 多角色对话生成     | 将内容转化为生动的多人物对话形式，提升趣味性 |
| 🔍 智能素材匹配       | 基于语义分析自动匹配相关视频与图片素材 |
| 🗣️ AI 语音合成       | 支持多角色自然语音配音，情感丰富、音色多样 |
| 🎥 全流程视频制作     | 自动完成剪辑、字幕添加、画面合成等后期处理 |

### 🎯 应用场景

- 📰 **新闻资讯视频化**：快速将热点新闻转化为短视频，抢占流量先机  
- 📚 **文章内容可视化**：把枯燥的文字变成有声有色的视频，增强传播力  
- 🎤 **播客内容制作**：自动生成对话式播客，节省录制与编辑时间  
- 📱 **批量短视频生产**：适用于自媒体运营、企业宣传、知识科普等领域  
- 🎮 **游戏攻略视频化**：将游戏资讯、操作指南等内容快速生成视频  

### 📂 示例展示

> 注意：以下示例视频经过剪辑压缩，仅展示部分效果。完整视频可通过点击标题查看原文后自行生成。

📄 **原文参考**：[《为了电动车，美国十七州“怒告”特朗普》](https://36kr.com/p/3286128054051718)

<table>
    <thead>
        <tr>
            <th align="center"><g-emoji class="g-emoji" alias="arrow_forward">▶️</g-emoji>播客</th>
            <th align="center"><g-emoji class="g-emoji" alias="arrow_forward">▶️</g-emoji>相声</th>
            <th align="center"><g-emoji class="g-emoji" alias="arrow_forward">▶️</g-emoji>脱口秀</th>
        </tr>
    </thead>
    <tbody>
        <tr>
            <td align="center"><video src="https://github.com/user-attachments/assets/a8a4175d-2ebf-47cc-9c81-8c9a7aa78ae1"></video></td>
            <td align="center"><video src="https://github.com/user-attachments/assets/d1819bc3-c909-4ede-927c-57a10f609827"></video></td>
            <td align="center"><video src="https://github.com/user-attachments/assets/896de713-e059-4834-b5ca-91a514d89d24"></video></td>
        </tr>
    </tbody>
</table>

### 🛠️ 技术栈

- **后端框架**：FastAPI  
- **前端界面**：Streamlit  
- **AI 引擎**：Deepseek API  
- **语音合成**：Tongyi TTS  
- **视频处理**：FFmpeg  
- **数据存储**：SQLite  

### 🚀 快速开始

#### 系统要求

- Python 3.10 或以上版本  
- FFmpeg 已安装并配置环境变量  
- ImageMagick（用于图像处理）

#### 安装步骤

```bash
# 克隆项目仓库
git clone https://github.com/chenwr727/CodexReel.git
cd CodexReel

# 创建并激活虚拟环境
conda create -n url2video python=3.10
conda activate url2video

# 安装依赖包
pip install -r requirements.txt
conda install -c conda-forge ffmpeg
```

#### 配置文件设置

```bash
# 复制配置模板
cp config-template.toml config.toml
```

请编辑 `config.toml` 文件，填写以下必要参数：
- Deepseek Key  
- Tongyi TTS 密钥  
- Pexels 或 Pixabay API Key  
- 可选：其他高级配置项  

### 🖥️ 使用方式

#### 启动 Web 界面

```bash
# 启动后端服务
python app.py

# 启动前端界面
streamlit run web.py --server.port 8000
```

![demo](./demo.png)

#### 命令行运行

```bash
# 转换单篇文章为视频
python main.py https://example.com/article
```

### 📂 项目结构概览

```
CodexReel/
├── api/                    # API接口模块
│   ├── crud.py             # 数据库操作
│   ├── database.py         # 数据库配置
│   ├── models.py           # 数据模型
│   ├── router.py           # 路由定义
│   └── service.py          # 业务逻辑
├── schemas/                # 数据模型定义
│   ├── config.py           # 配置模型
│   ├── task.py             # 任务模型
│   └── video.py            # 视频模型
├── services/               # 外部服务集成
│   ├── material/           # 视频素材服务
│   │   ├── base.py         # 视频素材基础接口
│   │   ├── pexels.py       # Pexels服务
│   │   └── pixabay.py      # Pixabay服务
│   ├── tts/                # TTS服务
│   │   ├── base.py         # TTS基础接口
│   │   ├── dashscope.py    # DashScope服务
│   │   ├── edge.py         # Edge服务
│   │   └── kokoro.py       # Kokoro服务
│   ├── llm.py              # LLM服务
│   └── video.py            # 视频处理服务
├── utils/                  # 工具模块
│   ├── config.py           # 配置管理
│   ├── log.py              # 日志工具
│   ├── subtitle.py         # 字幕处理
│   ├── text.py             # 文本处理
│   ├── url.py              # URL处理
│   └── video.py            # 视频工具
├── app.py                  # FastAPI 入口
├── main.py                 # 主程序入口
└── web.py                  # Web 界面入口
```

### 🤝 贡献指南

我们欢迎任何形式的贡献！无论是代码提交、文档完善、UI 设计，还是测试反馈，都对项目发展至关重要。

1. Fork 本仓库  
2. 创建新特性分支 (`git checkout -b feature/amazing-feature`)  
3. 提交更改 (`git commit -m 'Add amazing feature'`)  
4. 推送至远程仓库 (`git push origin feature/amazing-feature`)  
5. 发起 Pull Request  

### 📄 开源协议

MIT License

### 🙏 致谢

- 受 [NotebookLlama](http://github.com/meta-llama/llama-cookbook/tree/main/end-to-end-use-cases/NotebookLlama) 项目启发  
- 感谢所有开发者、测试者和用户的支持与参与