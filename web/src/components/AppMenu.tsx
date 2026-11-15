import { useEffect, useRef, useState } from "react";
import { bridge, type MenuAction } from "../bridge";

interface MenuItemDef {
  label: string;
  action: MenuAction;
  hint?: string;
}

interface MenuDef {
  id: string;
  label: string;
  items: MenuItemDef[];
}

const MENUS: MenuDef[] = [
  {
    id: "file",
    label: "文件",
    items: [
      { label: "设置…", action: "settings", hint: "Ctrl+," },
      { label: "打开输出目录", action: "output-dir", hint: "Ctrl+O" },
      { label: "打开配置文件", action: "config-file" },
      { label: "退出", action: "quit" },
    ],
  },
  {
    id: "help",
    label: "帮助",
    items: [{ label: "关于", action: "about" }],
  },
];

/** 顶部菜单栏：代替原生菜单，动作交给主进程 */
export function AppMenu() {
  const [open, setOpen] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;

    function onDown(event: MouseEvent) {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(null);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(null);
    }

    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  async function run(action: MenuAction) {
    setOpen(null);
    const api = bridge();
    if (!api) {
      window.alert("该功能只在桌面应用里可用。");
      return;
    }
    try {
      const res = await api.menu(action);
      if (!res.ok) window.alert(res.error ?? "操作失败");
    } catch (error) {
      window.alert(error instanceof Error ? error.message : String(error));
    }
  }

  return (
    <div className="menubar" ref={wrapRef}>
      {MENUS.map((menu) => (
        <div className="menu" key={menu.id}>
          <button
            type="button"
            className={`menu-btn${open === menu.id ? " open" : ""}`}
            aria-haspopup="menu"
            aria-expanded={open === menu.id}
            onClick={() => setOpen(open === menu.id ? null : menu.id)}
            onMouseEnter={() => setOpen((prev) => (prev ? menu.id : prev))}
          >
            {menu.label}
          </button>

          {open === menu.id && (
            <div className="menu-pop" role="menu">
              {menu.items.map((item) => (
                <button type="button" role="menuitem" key={item.action} className="menu-item" onClick={() => void run(item.action)}>
                  <span>{item.label}</span>
                  {item.hint && <span className="menu-hint">{item.hint}</span>}
                </button>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
