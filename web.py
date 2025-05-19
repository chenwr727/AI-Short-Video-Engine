import datetime
import json
import os

import pandas as pd
import requests
import streamlit as st
import streamlit_authenticator as stauth
import yaml
from yaml.loader import SafeLoader

from api.schemas import TaskCreate
from schemas.config import MaterialSource, PromptSource, TTSSource
from utils.config import config
from utils.url import parse_url


class TaskAPIClient:
    def __init__(self, base_url: str):
        self.base_url = base_url.rstrip("/")

    def create_task(self, task_create: TaskCreate) -> requests.Response:
        url = f"{self.base_url}/v1/tasks"
        return requests.post(url, json=task_create.model_dump())

    def get_task_status(self, task_id: str) -> requests.Response:
        url = f"{self.base_url}/v1/tasks/{task_id}"
        return requests.get(url)

    def get_task_list(self, task_date: datetime.date) -> requests.Response:
        url = f"{self.base_url}/v1/tasks/list/{task_date}"
        return requests.get(url)

    def cancel_task(self, task_id: str) -> requests.Response:
        url = f"{self.base_url}/v1/tasks/{task_id}/cancel"
        return requests.post(url)

    def get_queue_status(self) -> requests.Response:
        url = f"{self.base_url}/v1/tasks/queue/status"
        return requests.get(url)


@st.cache_data(ttl="2h")
def get_hot_list():
    url = "https://api.vvhan.com/api/hotlist/all"
    try:
        response = requests.get(url, timeout=5)
        if response.status_code == 200:
            return response.json()
        else:
            return []
    except Exception:
        return []


def init_session_state():
    if "current_task_name" not in st.session_state:
        st.session_state.current_task_name = None


def format_task_data(tasks: list) -> pd.DataFrame:
    if not tasks:
        return pd.DataFrame()
    df = pd.DataFrame(tasks)
    return df


def render_task_status(status: str) -> str:
    colors = {
        "pending": "blue",
        "running": "orange",
        "completed": "green",
        "failed": "red",
        "timeout": "gray",
    }
    return f":{colors.get(status, 'black')}[{status}]"


def load_authenticator() -> stauth.Authenticate:
    with open("auth.yaml") as file:
        config = yaml.load(file, Loader=SafeLoader)

    authenticator = stauth.Authenticate(
        credentials=config["credentials"],
        cookie_name=config["cookie"]["name"],
        key=config["cookie"]["key"],
        cookie_expiry_days=config["cookie"]["expiry_days"],
    )

    return authenticator


def handle_authentication(authenticator: stauth.Authenticate) -> bool:
    try:
        authenticator.login()

        if not st.session_state["authentication_status"]:
            st.error("Username/password is incorrect")
            return False
        elif st.session_state["authentication_status"] is None:
            st.warning("Please enter your username and password")
            return False

        return True

    except Exception as e:
        st.error(f"Authentication error: {str(e)}")
        return False


def main():
    st.set_page_config(page_title="Task Management System", layout="wide")
    init_session_state()

    authenticator = load_authenticator()
    if not handle_authentication(authenticator):
        return

    prompt_source_list = [e.value for e in PromptSource]
    prompt_source = st.sidebar.selectbox("Select Prompt Source", prompt_source_list)

    tts_source_list = [e.value for e in TTSSource]
    tts_source = st.sidebar.selectbox("Select TTS Source", tts_source_list)

    material_source_list = [e.value for e in MaterialSource]
    material_source = st.sidebar.selectbox("Select Material Source", material_source_list)

    use_yuanbao = st.sidebar.checkbox("Use yuanbao")
    if use_yuanbao:
        role = st.sidebar.selectbox("Select Role", PROMPTS.keys())
        prompt = "yuanbao" + PROMPTS[role]
    else:
        prompt = ""

    task_create = TaskCreate(
        name="", prompt_source=prompt_source, tts_source=tts_source, material_source=material_source
    )

    tab1, tab2, tab3 = st.tabs(["Task List", "Hot List", "Create Task"])

    with tab1:
        task_date = st.date_input("Select Date", datetime.date.today())

        if task_date:
            response = api_client.get_task_list(task_date)
            if response.status_code == 200:
                df = format_task_data(response.json())
                if not df.empty:
                    event = st.dataframe(
                        df,
                        hide_index=True,
                        use_container_width=True,
                        on_select="rerun",
                        selection_mode="single-row",
                        column_config={"name": st.column_config.LinkColumn(validate=r"^https?://.+$")},
                    )
                    if event.selection["rows"]:
                        task_data = df.iloc[event.selection["rows"][0]].to_dict()
                        task_id = task_data["id"]

                        if st.button("Check Status"):
                            response = api_client.get_task_status(task_id)
                            if response.status_code == 200:
                                task_data = response.json()

                        st.markdown("### Task Information")
                        st.json(task_data)

                        folder = parse_url("", int(task_id))
                        file_json = os.path.join(folder, "_transcript.json")
                        if os.path.exists(file_json):
                            expander = st.expander("See dialogue")
                            with open(file_json, "r", encoding="utf-8") as f:
                                json_data = json.load(f)
                                expander.json(json_data)

                        if task_data["result"]:
                            if task_data["status"] == "completed":
                                if os.path.exists(task_data["result"]):
                                    st.markdown("### Task Result")
                                    st.video(task_data["result"])
                                    with open(task_data["result"], "rb") as f:
                                        st.download_button(
                                            label="Download Video",
                                            data=f,
                                            file_name=f"{task_data['id']}.mp4",
                                            mime="video/mp4",
                                        )
                            else:
                                st.markdown(f"```{task_data['result']}```")

                        if st.button("Rerun Task"):
                            task_create.name = task_data["name"]
                            response = api_client.create_task(task_create)
                            if response.status_code == 200:
                                st.success("Task rerun successfully!")
                            else:
                                st.error("Failed to rerun task")

                        if st.button("Cancel Task"):
                            response = api_client.cancel_task(task_id)
                            if response.status_code == 200:
                                st.success("Task has been canceled")
                            else:
                                st.error("Failed to cancel task")

                        if st.button("Reset Task"):
                            for filename in os.listdir(folder):
                                if filename == "_html.txt":
                                    continue
                                file_path = os.path.join(folder, filename)
                                if os.path.isfile(file_path):
                                    os.remove(file_path)
                            st.success("Task has been reset")
                else:
                    st.info("No task records for the selected date")
            else:
                st.error("Failed to retrieve task list")

    with tab2:
        hot_list = get_hot_list()
        if hot_list:
            st.subheader("Hot List")
            hot_dict = {data["name"]: data["data"] for data in hot_list["data"]}
            selected_hot = st.selectbox("Select Hot List", hot_dict.keys())
            selected_hot_data = hot_dict[selected_hot]
            df = pd.DataFrame(selected_hot_data, columns=["index", "title", "url", "hot"])
            event = st.dataframe(
                df,
                height=(len(df) + 1) * 35 + 3,
                hide_index=True,
                use_container_width=True,
                on_select="rerun",
                selection_mode="single-row",
                column_config={"url": st.column_config.LinkColumn(display_text="Open")},
            )
            if event.selection["rows"]:
                row = df.iloc[event.selection["rows"][0]]
                st.session_state.current_task_name = row["url"]
            else:
                st.session_state.current_task_name = None

    with tab3:
        st.subheader("Create New Task")
        with st.form("create_task_form"):
            task_name = st.text_input("Task Name", value=st.session_state.current_task_name or "")
            task_name = prompt + task_name
            submitted = st.form_submit_button("Create Task")
            if submitted and task_name:
                task_create.name = task_name
                response = api_client.create_task(task_create)
                if response.status_code == 200:
                    st.success("Task created successfully!")
                    data = response.json()
                    st.json(data)
                    st.session_state.current_task_name = task_name
                else:
                    st.error("Failed to create task")


PROMPTS = {
    "股票投资顾问": "你是一位资深的商业顾问，能够帮助我在股市、市场分析、买卖股票策略等方面做出明智的决策。请根据行业趋势、市场研究和最佳实践提供实用的商业建议。",
    "新闻记者": "我希望你能作为一名记者行事。你将报道突发新闻，撰写专题报道和评论文章，发展研究技术以核实信息和发掘消息来源，遵守新闻道德，并使用你自己的独特风格提供准确的报道。我的新闻主题要求是。",
    "研究学者": "我希望你能作为一名学者行事。你将负责研究一个我选择的主题，并将研究结果以论文或文章的形式呈现出来。你的任务是确定可靠的来源，以结构良好的方式组织材料，并以引用的方式准确记录。我的选择的主题如下。",
    "专业导游": "你是专业导游，根据我输入的目的地，帮我做一份为期 2 天的旅游攻略。另外，我希望整个流程不用太紧凑，我更偏向于安静的地方，可以简单的游玩逛逛。在回答时，记得附上每一个地方的价格。",
    "创意小说家": "你是一个小说家。按照我提供的主题，你要想出有创意的、吸引人的故事，能够长时间吸引读者。你可以选择任何题材，如幻想、浪漫、历史小说等。但目的是要写出有出色的情节线、引人入胜的人物和意想不到的高潮。我输入的主题如下。",
    "成语大师": "你是一位精通古今中外的成语大师，你的任务是对我给出的成语和谚语提供清晰的含义和来源解释。你是一位精通古今中外的成语大师，你的任务是对我给出的成语和谚语提供清晰的含义和来源解释。",
    "电影评论家": "你是一位资深电影评论家，擅长从以下维度分析影片： 1. ​核心要素评价 - 导演风格与叙事结构 - 表演层次（主角/配角表现） - 视听语言（摄影/配乐/美术） - 剧本张力与主题深度 2. ​输出要求 ✓ 开篇用1句话概括影片本质 ✓ 包含「亮点聚焦」和「缺陷指正」板块 ✓ 结合电影史或同类型影片对比 ✓ 避免剧透关键情节 3. ​风格控制 - 语言：专业但不晦涩 - 视角：客观分析为主，主观感受为辅 - 篇幅：800-1200字（可调整） 请根据以下的电影名称，生成一段影评。",
    "人物锐评": "你是一个毒舌且公正的评论家，擅长从以下维度锐评人物：性格、长相、命运走向；我输出的内容，就是人物的名字。",
}


base_url = f"http://localhost:{config.api.app_port}"
api_client = TaskAPIClient(base_url)

if __name__ == "__main__":
    main()
