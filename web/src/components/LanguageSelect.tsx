import type { JSX } from "react";
import { readLanguagePreference, saveLanguagePreference, useLanguage, useT, type LanguagePreference } from "../i18n";
import { Dropdown, type DropdownOption } from "./Dropdown";

interface LanguageSelectProps {
  id?: string;
  /** 悬停提示，设置页 / 关于页里通常写「语言」 */
  title?: string;
  disabled?: boolean;
}

/**
 * 语言选择器。
 *
 * 只是给 Dropdown 包一层：弹层定位、键盘操作、无障碍属性它都已经有了，
 * 这里只负责把偏好翻成三项、选中后写回 localStorage。
 *
 * 不自己存 state —— useLanguage() 订阅了语言变化，saveLanguagePreference()
 * 会通知所有订阅者，界面自然重渲染，两处语言设置也就互相同步了。
 */
export function LanguageSelect({ id, title, disabled }: LanguageSelectProps): JSX.Element {
  const t = useT();
  // 订阅语言变化：切换后重渲染，三项标签跟着换成新语言
  useLanguage();
  // 现读偏好，不缓存 —— 偏好可能被别的窗口改掉
  const value = readLanguagePreference();

  // 三项顺序与 LanguagePreference 一致：先是明确的中英，最后才是跟随系统
  const options: DropdownOption[] = [
    { value: "zh", label: t("common.chinese") },
    { value: "en", label: t("common.english") },
    { value: "system", label: t("theme.system") },
  ];

  return (
    <Dropdown
      id={id}
      value={value}
      options={options}
      onChange={(next) => {
        // 选项值就是我们自己给的这三项，拿回来只可能是 LanguagePreference
        saveLanguagePreference(next as LanguagePreference);
      }}
      disabled={disabled}
      title={title}
    />
  );
}
