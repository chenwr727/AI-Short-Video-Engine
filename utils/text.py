import re
from typing import List


def split_content_with_punctuation(content: str, min_length: int = 10) -> List[str]:
    if not content:
        raise ValueError("Content cannot be empty.")

    punctuation_pattern = r"([。！？；])"
    parts = re.split(punctuation_pattern, content)

    sentences = []
    temp = ""
    for part in parts:
        if part:
            temp += part
            if part in "。！？；":
                sentences.append(temp)
                temp = ""
    if temp:
        sentences.append(temp)

    contents = []
    current_sentence = ""

    for sentence in sentences:
        if len(current_sentence) < min_length:
            current_sentence += sentence
        else:
            if current_sentence:
                contents.append(current_sentence)
            current_sentence = sentence

    if current_sentence:
        if contents and len(current_sentence) < min_length / 2:
            contents[-1] += current_sentence
        else:
            contents.append(current_sentence)

    return contents
