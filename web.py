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


def init_session_state():
    if "current_task_name" not in st.session_state:
        st.session_state.current_task_name = None


def format_task_data(tasks: list) -> pd.DataFrame:
    """Build a clean, human-readable dataframe for the task list."""
    if not tasks:
        return pd.DataFrame()
    df = pd.DataFrame(tasks)
    keep = ["id", "name", "status", "create_time", "update_time", "error_message"]
    df = df[[c for c in keep if c in df.columns]].copy()

    if "status" in df.columns:
        df["status"] = df["status"].map(render_task_status)

    if "error_message" in df.columns:
        df["error_message"] = df["error_message"].fillna("").map(lambda s: s if len(s) <= 60 else s[:60] + "…")

    if "name" in df.columns:
        df["name"] = df["name"].map(lambda s: s if len(s) <= 60 else s[:60] + "…")
    return df


def render_task_status(status: str) -> str:
    colors = {
        "pending": "blue",
        "running": "orange",
        "completed": "green",
        "failed": "red",
        "timeout": "gray",
        "cancelled": "purple",
    }
    return f":{colors.get(status, 'black')}[{status}]"


def load_authenticator() -> stauth.Authenticate:
    with open("auth.yaml") as file:
        config = yaml.load(file, Loader=SafeLoader)

    authenticator = stauth.Authenticate(
        credentials=config["credentials"],
        cookie_name=config["cookie"]["name"],
        cookie_key=config["cookie"]["key"],
        cookie_expiry_days=config["cookie"]["expiry_days"],
    )

    return authenticator


def handle_authentication(authenticator: stauth.Authenticate) -> bool:
    try:
        authenticator.login()

        if not st.session_state["authentication_status"]:
            st.error("用户名或密码错误")
            return False
        elif st.session_state["authentication_status"] is None:
            st.warning("请输入用户名和密码")
            return False

        return True

    except Exception as e:
        st.error(f"认证失败: {str(e)}")
        return False


def main():
    st.set_page_config(page_title="AI 短视频任务管理", page_icon="🎬", layout="wide")
    init_session_state()

    authenticator = load_authenticator()
    if not handle_authentication(authenticator):
        return

    st.sidebar.markdown("## 任务配置")
    prompt_source_list = [e.value for e in PromptSource]
    prompt_source = st.sidebar.selectbox("脚本 Prompt 源", prompt_source_list)

    tts_source_list = [e.value for e in TTSSource]
    tts_source = st.sidebar.selectbox("TTS 引擎", tts_source_list)

    material_source_list = [e.value for e in MaterialSource]
    material_source = st.sidebar.selectbox("素材源", material_source_list)

    try:
        qr = api_client.get_queue_status()
        if qr.status_code == 200:
            q = qr.json()
            running = q.get("running_tasks", 0)
            max_conc = q.get("max_concurrent_tasks", 0)
            available = q.get("available_slots", 0)
            st.sidebar.markdown("---")
            st.sidebar.markdown("## 队列状态")
            st.sidebar.metric("运行中任务", running)
            st.sidebar.metric("可用槽位", f"{available}/{max_conc}")
    except Exception:
        pass

    if st.sidebar.button("刷新队列状态", use_container_width=True):
        st.rerun()

    st.sidebar.markdown("---")
    authenticator.logout(button_name="退出登录", location="sidebar", key="logout", use_container_width=True)

    task_create = TaskCreate(
        name="", prompt_source=prompt_source, tts_source=tts_source, material_source=material_source
    )

    tab1, tab3 = st.tabs(["📋 任务列表", "➕ 创建任务"])

    with tab1:
        col_date, col_refresh, _ = st.columns([2, 1, 3])
        task_date = col_date.date_input("选择日期", datetime.date.today())
        col_refresh.button("🔄 刷新列表", use_container_width=True, on_click=lambda: st.rerun())

        if task_date:
            response = api_client.get_task_list(task_date)
            if response.status_code == 200:
                df = format_task_data(response.json())
                if not df.empty:
                    event = st.dataframe(
                        df,
                        hide_index=True,
                        width="stretch",
                        on_select="rerun",
                        selection_mode="single-row",
                        column_config={
                            "id": "ID",
                            "name": "任务名称",
                            "status": "状态",
                            "create_time": "创建时间",
                            "update_time": "更新时间",
                            "error_message": "错误信息",
                        },
                    )
                    if event.selection["rows"]:
                        task_data = df.iloc[event.selection["rows"][0]].to_dict()
                        task_id = task_data["id"]

                        fresh = api_client.get_task_status(task_id)
                        if fresh.status_code == 200:
                            task_data = fresh.json()

                        st.markdown("### 任务详情")
                        st.json(task_data)

                        if task_data.get("error_message"):
                            st.error(f"错误信息: {task_data['error_message']}")

                        folder = parse_url("", int(task_id))
                        file_json = os.path.join(folder, "_transcript.json")
                        if os.path.exists(file_json):
                            expander = st.expander("查看台词脚本")
                            with open(file_json, "r", encoding="utf-8") as f:
                                json_data = json.load(f)
                                expander.json(json_data)

                        if task_data.get("result"):
                            if task_data.get("status") == "completed":
                                if os.path.exists(task_data["result"]):
                                    st.markdown("### 生成结果")
                                    st.video(task_data["result"])
                                    with open(task_data["result"], "rb") as f:
                                        st.download_button(
                                            label="📥 下载视频",
                                            data=f,
                                            file_name=f"{task_data['id']}.mp4",
                                            mime="video/mp4",
                                        )
                            else:
                                st.markdown(f"```{task_data['result']}```")

                        c1, c2, c3 = st.columns(3)
                        with c1:
                            if st.button("🔁 重新运行", use_container_width=True):
                                task_create.name = task_data["name"]
                                response = api_client.create_task(task_create)
                                if response.status_code == 200:
                                    st.success("任务已重新排队！")
                                else:
                                    st.error("重新运行失败")
                        with c2:
                            if st.button("⏹ 取消任务", use_container_width=True):
                                response = api_client.cancel_task(task_id)
                                if response.status_code == 200:
                                    st.success("任务已取消")
                                else:
                                    st.error("取消失败")
                        with c3:
                            if st.button("🗑 重置任务", use_container_width=True):
                                for filename in os.listdir(folder):
                                    if filename == "_html.txt":
                                        continue
                                    file_path = os.path.join(folder, filename)
                                    if os.path.isfile(file_path):
                                        os.remove(file_path)
                                st.success("任务已重置")
                else:
                    st.info("所选日期没有任务记录")
            else:
                st.error("获取任务列表失败")

    with tab3:
        st.subheader("创建新任务")
        st.caption("支持输入网页 URL，或直接粘贴文章内容文本，系统将自动生成短视频。")
        with st.form("create_task_form"):
            task_name = st.text_input(
                "内容（URL 或文本）",
                value=st.session_state.current_task_name or "",
                placeholder="例如：https://example.com/article 或直接粘贴正文内容",
                help="输入网页链接或文章正文，二者选其一。",
            )
            submitted = st.form_submit_button("🚀 创建任务")

            if submitted:
                if not task_name or not task_name.strip():
                    st.error("请输入 URL 或文章内容")
                else:
                    task_create.name = task_name.strip()
                    response = api_client.create_task(task_create)
                    if response.status_code == 200:
                        st.success("任务创建成功，已加入处理队列！")
                        data = response.json()
                        st.json(data)
                        st.session_state.current_task_name = task_name.strip()
                    else:
                        st.error(f"创建任务失败（{response.status_code}）")


base_url = f"http://localhost:{config.api.app_port}"
api_client = TaskAPIClient(base_url)

if __name__ == "__main__":
    main()
