import json
from datetime import date, datetime
from zoneinfo import ZoneInfo

from mojito_worker.config import TIMEZONE


def now_context() -> str:
    now = datetime.now(ZoneInfo(TIMEZONE))
    return f"现在是 {now.isoformat(timespec='minutes')}（{now:%A}，用户时区 {TIMEZONE}）。hub 数据里的时间是 UTC，换算成用户时区再判断。"


# Appended to every prompt whose output the user reads (record titles/bodies, item fields, cards, chat).
USER_TEXT_RULES = """写给用户看的文字规则：时间一律写用户时区的短格式（如 9/28 00:50、10/2 周五 10:00），不要写 ISO 时间；
不要写任何内部 id（记录、事项、计划、项目、目标的 id 都不写，用标题或名字指代；id 只放在 evidence 之类的字段里）；
不要写英文枚举值（done、waiting_you、active、auto_then_me 等），用中文说法（完成、待你确认、进行中、先机器后你）；
不要写文件路径、代码名 / 函数名、英文字段名（next_step、run_jobs 之类），用人话说（"下一步"、"已开始跑"）。"""

LANGUAGE_RULES = {
    "zh": "写给用户看的文字一律用中文。",
    "en": """写给用户看的文字（回复、标题、正文、事项的标题和下一步、卡片摘要、草稿等）一律用英文（English），上面的规则同样适用：
时间写 9/28 00:50、Fri 10/2 10:00 这种短格式；不写内部 id、枚举值、文件路径、代码名、字段名，用自然的英文说法（done、waiting for you、in progress）。
提示词里让你对用户说的中文句子（如"已开始，跑完进信息流"），用英文表达同样的意思。""",
}


def user_text_rules(lang: str) -> str:
    """USER_TEXT_RULES plus which language user-facing text is written in (settings.language)."""
    return f"{USER_TEXT_RULES}\n{LANGUAGE_RULES[lang]}"


def short_time(iso: str) -> str:
    """ISO datetime -> short form in the owner's timezone for user-facing text, e.g. 9/28 00:50."""
    t = datetime.fromisoformat(iso).astimezone(ZoneInfo(TIMEZONE))
    return f"{t.month}/{t.day} {t:%H:%M}"


def short_date(d: date) -> str:
    return f"{d.month}/{d.day}"


def dump(obj) -> str:
    return json.dumps(obj, ensure_ascii=False, indent=2)
