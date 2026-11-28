English | [简体中文](artifacts.md)

# Task Artifacts and Resuming

Each task keeps a full set of intermediate files under `<data dir>/workspaces/<timestamp>/` (`server/data/workspaces/` when running from source, `UserData/data/workspaces/` for the portable build):

```
20261115-214501/
  _html.txt          # fetched article
  _transcript.txt    # LLM draft
  _transcript.json   # confirmed structured script
  _terms.json        # search terms per segment
  *.mp3              # per-sentence audio, named segment_sentence_part
  _durations.json    # audio durations
  _videos.json       # footage manifest
  clips/ subs/       # segment videos and ASS subtitles
  cards/             # card videos and stills, fingerprinted by their parameters
  _task.json         # task state snapshot (includes the card manifest) for resuming
  _bgm.wav           # mixed background music
  _output.mp4        # final video
```

A rerun after an interruption reuses what is already on disk and only fills in the missing parts; clicking **Regenerate** on the preview page deletes `_output.mp4` and `clips/` and reruns composition, keeping all audio and footage.

For the data directory location and variables such as `SHORTDECK_DATA_DIR`, see [configuration_EN.md](configuration_EN.md#environment-variables); **File → Open data directory** takes you straight there.
