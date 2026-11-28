English | [简体中文](prompts.md)

# Prompt Editor

**File → Prompts…** (`Ctrl+P`) opens a separate window for editing the built-in prompts. Changes are written under `prompts/` in the data directory and **only cover the keys you touched**: reads fall back from the override layer to the built-in file key by key, so deleting one key never invalidates the whole file. Saving takes effect for the next task's drafting / search; existing tasks are untouched.

The 19 editable fields:

| File | Field | Purpose |
| --- | --- | --- |
| `podcast.json` | Writer / Polisher | Structure, segment count and tone of the podcast |
| `crosstalk.json` | Writer / Polisher | Structure and punchline density of the crosstalk act |
| `talkshow.json` | Writer / Polisher | Structure and style of the stand-up bit |
| `critic.json` | Review / Repair | Scoring dimensions and repair direction; too strict a prompt flattens the script back to something tidy |
| `material.json` | Search terms | Turn lines into English keywords for stock sites |
| `video_select.json` | Clip pick | Pick footage by tags |
| `vision_select.json` | Visual pick | Pick footage from thumbnails; also likelier to grab unrelated shots |
| `card_accent.json` | System message / User message | Pick an accent from the palette using material thumbnails |
| `card_chapters.json` | System message / User message | Intro, chapter and outro titles plus layouts |
| `card_rewrite.json` | System message / User message | Rewrite only the card title when asked for another option |
| `card_info.json` | System message / User message | Build an info card grounded in the paragraph's lines |

Worth knowing:

- `{{SPEAKER_MAIN}}` / `{{SPEAKER_GUEST}}` are role-name placeholders, substituted from the names in settings before drafting — keep them when editing copy.
- Card templates use placeholders such as `{{PALETTE}}`, `{{TITLE}}` and `{{PARAGRAPHS}}` for runtime data — keep them too; the full list is in each field's hint in the prompt window.
- **Restore default** (top right of each field) only drops the override for that one key, removing the file too once it is empty; prompts cannot be saved empty.
- You can also edit `<data dir>/prompts/*.json` directly (same shape as the built-in files) — changes are picked up on save, no backend restart, because reads compare `mtime` and file size. Shortcut: **File → Open data directory**.
- Only the files and keys listed above are accepted; the API rejects arbitrary filenames so nothing can be written elsewhere.
- In dev you can also open `/prompts.html` on the frontend origin directly.

The override directory can be moved with `SHORTDECK_USER_PROMPTS_DIR`; see [configuration_EN.md](configuration_EN.md#environment-variables).
