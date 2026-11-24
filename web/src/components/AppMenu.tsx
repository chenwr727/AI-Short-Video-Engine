import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import { bridge, type MenuAction } from "../bridge";

/** action 交给主进程，local 由页内处理 */
interface MenuItemDef {
  label: string;
  action?: MenuAction;
  local?: "new-task";
  icon: ReactNode;
  /** 按平台渲染成 Ctrl / ⌘ */
  key?: string;
  danger?: boolean;
  /** 前置分隔线 */
  separator?: boolean;
}

interface MenuDef {
  id: string;
  label: string;
  items: MenuItemDef[];
}

const S = {
  width: 14,
  height: 14,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.9,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

const ICONS = {
  plus: (
    <svg {...S}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  ),
  gear: (
    <svg {...S}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1A1.6 1.6 0 0 0 9 19.4a1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1A1.6 1.6 0 0 0 4.6 9a1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z" />
    </svg>
  ),
  folder: (
    <svg {...S}>
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    </svg>
  ),
  database: (
    <svg {...S}>
      <ellipse cx="12" cy="5.5" rx="8" ry="3" />
      <path d="M4 5.5v13c0 1.7 3.6 3 8 3s8-1.3 8-3v-13M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3" />
    </svg>
  ),
  file: (
    <svg {...S}>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5" />
    </svg>
  ),
  power: (
    <svg {...S}>
      <path d="M12 4v8" />
      <path d="M7.5 7a7 7 0 1 0 9 0" />
    </svg>
  ),
  info: (
    <svg {...S}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5M12 7.6v.6" />
    </svg>
  ),
  book: (
    <svg {...S}>
      <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5z" />
      <path d="M4 20.5A2.5 2.5 0 0 1 6.5 18H20v3H6.5" />
    </svg>
  ),
  chat: (
    <svg {...S}>
      <path d="M20 12a7.5 7.5 0 0 1-7.5 7.5H9L4 22l1.2-4.1A7.5 7.5 0 1 1 20 12z" />
    </svg>
  ),
};

const MENUS: MenuDef[] = [
  {
    id: "file",
    label: "文件",
    items: [
      { label: "新建一条", local: "new-task", icon: ICONS.plus, key: "N" },
      { label: "设置…", action: "settings", icon: ICONS.gear, key: ",", separator: true },
      { label: "提示词…", action: "prompts", icon: ICONS.book, key: "P" },
      { label: "打开输出目录", action: "output-dir", icon: ICONS.folder, key: "O", separator: true },
      { label: "打开数据目录", action: "data-dir", icon: ICONS.database },
      { label: "打开配置文件", action: "config-file", icon: ICONS.file },
      { label: "退出", action: "quit", icon: ICONS.power, danger: true, separator: true },
    ],
  },
  {
    id: "help",
    label: "帮助",
    items: [
      { label: "使用说明", action: "docs", icon: ICONS.book },
      { label: "反馈问题", action: "feedback", icon: ICONS.chat },
      { label: "关于", action: "about", icon: ICONS.info, separator: true },
    ],
  },
];

/** macOS 用 ⌘，其余用 Ctrl */
function hint(label: string, platform: string | undefined): string {
  const mod = platform === "darwin" ? "⌘" : "Ctrl+";
  return `${mod}${label}`;
}

interface AppMenuProps {
  onNewTask: () => void;
}

/** 代替原生菜单栏 */
export function AppMenu({ onNewTask }: AppMenuProps) {
  const [open, setOpen] = useState<string | null>(null);
  /** 键盘高亮项，-1 = 无 */
  const [active, setActive] = useState(-1);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const desktop = Boolean(bridge());
  const platform = bridge()?.platform;

  const menu = MENUS.find((m) => m.id === open) ?? null;
  const items = menu?.items ?? [];

  useEffect(() => {
    if (!open) return;

    function onDown(event: MouseEvent) {
      if (!wrapRef.current?.contains(event.target as Node)) {
        setOpen(null);
        setActive(-1);
      }
    }

    function onKey(event: KeyboardEvent) {
      if (!menu) return;
      const count = menu.items.length;

      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(null);
        setActive(-1);
        return;
      }
      // 左右换相邻菜单
      if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
        event.preventDefault();
        const dir = event.key === "ArrowRight" ? 1 : -1;
        const index = MENUS.findIndex((m) => m.id === menu.id);
        setOpen(MENUS[(index + dir + MENUS.length) % MENUS.length]?.id ?? null);
        setActive(-1);
        return;
      }
      // 只在有高亮项时拦回车，否则会吞掉页面其它回车
      if ((event.key === "Enter" || event.key === " ") && active >= 0) {
        const item = menu.items[active];
        if (!item) return;
        event.preventDefault();
        void run(item);
        return;
      }
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
      event.preventDefault();
      const dir = event.key === "ArrowDown" ? 1 : -1;
      setActive((prev) => {
        if (prev < 0) return dir > 0 ? 0 : count - 1;
        return (prev + dir + count) % count;
      });
    }

    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, menu, active]);

  if (!desktop) return null;

  async function run(item: MenuItemDef) {
    setOpen(null);
    setActive(-1);

    if (item.local === "new-task") {
      onNewTask();
      return;
    }
    if (!item.action) return;

    const api = bridge();
    if (!api) {
      window.alert("该功能只在桌面应用里可用。");
      return;
    }
    try {
      const res = await api.menu(item.action);
      if (!res.ok) window.alert(res.error ?? "操作失败");
    } catch (error) {
      window.alert(error instanceof Error ? error.message : String(error));
    }
  }

  return (
    <div className="menubar" ref={wrapRef}>
      {MENUS.map((m) => (
        <div className="menu" key={m.id}>
          <button
            type="button"
            className={`menu-btn${open === m.id ? " open" : ""}`}
            aria-haspopup="menu"
            aria-expanded={open === m.id}
            onClick={() => {
              setOpen(open === m.id ? null : m.id);
              setActive(-1);
            }}
            onMouseEnter={() => {
              if (!open) return;
              setOpen(m.id);
              setActive(-1);
            }}
          >
            {m.label}
          </button>

          {open === m.id && (
            <div className="menu-pop" role="menu">
              {items.map((item, index) => (
                <Fragment key={item.label}>
                  {item.separator && <div className="menu-sep" aria-hidden="true" />}
                  <button
                    type="button"
                    role="menuitem"
                    className={`menu-item${item.danger ? " menu-danger" : ""}${active === index ? " active" : ""}`}
                    onMouseEnter={() => setActive(index)}
                    onClick={() => void run(item)}
                  >
                    <span className="menu-icon" aria-hidden="true">
                      {item.icon}
                    </span>
                    <span className="menu-text">{item.label}</span>
                    {item.key && <span className="menu-hint">{hint(item.key, platform)}</span>}
                  </button>
                </Fragment>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
