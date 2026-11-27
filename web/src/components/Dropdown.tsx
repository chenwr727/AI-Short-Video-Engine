import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export interface DropdownOption {
  value: string;
  label: string;
}

interface DropdownProps {
  id?: string;
  value: string;
  options: DropdownOption[];
  onChange: (value: string) => void;
  disabled?: boolean;
  title?: string;
  /** 弹层最小宽度，默认与触发器等宽 */
  minWidth?: number;
}

/**
 * 原生 <select> 的弹层由 Chromium 自己绘制，`color-scheme` / `option` 背景只能改颜色，
 * 改不了它「先铺一层空背景、再画文字」的绘制顺序 —— 深色系统主题下就是先黑一下。
 *
 * 所以这里不用 <select>：触发器是个普通按钮，弹层是我们自己的 DOM，
 * 第一帧就是最终样式，不存在闪黑。
 *
 * 弹层用 portal 挂到 body 并用 fixed 定位，父级有 overflow 裁剪也不会被切掉。
 */
export function Dropdown({ id, value, options, onChange, disabled, title, minWidth }: DropdownProps) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number; width: number; up: boolean } | null>(null);
  /** 键盘高亮项的下标，-1 表示没有（鼠标操作时保持 -1） */
  const [active, setActive] = useState(-1);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const optionRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const current = options.find((o) => o.value === value) ?? options[0];
  const listId = id ? `${id}-listbox` : undefined;
  const activeId = open && active >= 0 && listId ? `${listId}-${active}` : undefined;

  // 定位：贴着触发器下方，空间不够就翻到上方
  useLayoutEffect(() => {
    if (!open) return;
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const width = Math.max(minWidth ?? 0, rect.width);
    const estHeight = Math.min(options.length * 34 + 10, 280);
    const below = window.innerHeight - rect.bottom;
    const up = below < estHeight + 12 && rect.top > below;
    setPos({ left: rect.left, top: up ? rect.top - 6 : rect.bottom + 6, width, up });
  }, [open, minWidth, options.length]);

  // 打开时把高亮停在当前值上，方向键从这里继续
  useEffect(() => {
    if (!open) {
      setActive(-1);
      return;
    }
    setActive(options.findIndex((o) => o.value === value));
  }, [open, options, value]);

  // 高亮项滚进可视区
  useEffect(() => {
    if (active < 0) return;
    optionRefs.current[active]?.scrollIntoView({ block: "nearest" });
  }, [active]);

  // 点外面 / 滚走 / 失焦 都关掉
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (triggerRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onScroll = (event: Event) => {
      // 弹层自己滚不算
      if (menuRef.current?.contains(event.target as Node)) return;
      setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", closeNow);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", closeNow);
    };
    function closeNow() {
      setOpen(false);
    }
  }, [open]);

  /** 选中并关闭；键盘与鼠标共用 */
  const choose = (index: number) => {
    const option = options[index];
    if (!option) return;
    onChange(option.value);
    setOpen(false);
    triggerRef.current?.focus();
  };

  const onTriggerKeyDown = (event: React.KeyboardEvent) => {
    if (disabled) return;
    if (!open) {
      // 方向键/回车/空格 都能打开，和原生 select 一致
      if (event.key === "ArrowDown" || event.key === "ArrowUp" || event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        setOpen(true);
      }
      return;
    }
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        setActive((prev) => (prev + 1) % options.length);
        break;
      case "ArrowUp":
        event.preventDefault();
        setActive((prev) => (prev <= 0 ? options.length - 1 : prev - 1));
        break;
      case "Home":
        event.preventDefault();
        setActive(0);
        break;
      case "End":
        event.preventDefault();
        setActive(options.length - 1);
        break;
      case "Enter":
      case " ":
        event.preventDefault();
        choose(active);
        break;
      case "Escape":
        event.preventDefault();
        setOpen(false);
        break;
      case "Tab":
        // 焦点要走了，顺手收起，别留一个悬空弹层
        setOpen(false);
        break;
      default:
        break;
    }
  };

  const menu =
    open && pos
      ? createPortal(
          <div
            ref={menuRef}
            id={listId}
            className="dropdown-menu"
            style={{
              left: pos.left,
              top: pos.top,
              minWidth: pos.width,
              transform: pos.up ? "translateY(-100%)" : undefined,
            }}
            role="listbox"
            aria-labelledby={id}
          >
            {options.map((option, index) => (
              <button
                key={option.value}
                ref={(el) => {
                  optionRefs.current[index] = el;
                }}
                id={listId ? `${listId}-${index}` : undefined}
                type="button"
                role="option"
                aria-selected={option.value === value}
                className={`dropdown-item${option.value === value ? " is-active" : ""}${
                  index === active ? " is-highlighted" : ""
                }`}
                // 鼠标移到哪就高亮哪，键盘接着从这里走
                onPointerEnter={() => setActive(index)}
                onClick={() => choose(index)}
              >
                {option.label}
              </button>
            ))}
          </div>,
          document.body,
        )
      : null;

  return (
    <>
      <button
        id={id}
        ref={triggerRef}
        type="button"
        className={`dropdown-trigger${open ? " is-open" : ""}`}
        disabled={disabled}
        title={title}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={activeId}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={onTriggerKeyDown}
      >
        <span className="dropdown-value">{current?.label ?? ""}</span>
        <span className="dropdown-caret" aria-hidden="true" />
      </button>
      {menu}
    </>
  );
}
