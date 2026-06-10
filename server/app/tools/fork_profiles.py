"""Fork profiles — predefined configurations for different fork types.

Inspired by Stello's ForkProfileRegistry. Each profile defines a context
strategy and an optional system prompt suffix injected into the child branch.
"""

from dataclasses import dataclass


@dataclass(frozen=True)
class ForkProfile:
    name: str
    label: str  # Chinese display name
    description: str
    system_prompt_suffix: str  # Appended to child branch system prompt
    context_strategy: str = "compress"  # none | inherit | compress


FORK_PROFILES: dict[str, ForkProfile] = {
    "deep_dive": ForkProfile(
        name="deep_dive",
        label="深入探讨",
        description="聚焦当前话题的深层细节，适合技术原理、实现细节的深入探索",
        system_prompt_suffix=(
            "你正在一个专注于深入探索的分支中。请：\n"
            "- 聚焦于当前话题的核心细节和底层原理\n"
            "- 提供具体的技术实现、代码示例或数据支撑\n"
            "- 追问'为什么'和'怎么做'，而非泛泛而谈\n"
            "- 如果涉及多个子话题，逐一深入而非广撒网"
        ),
        context_strategy="compress",
    ),
    "explore": ForkProfile(
        name="explore",
        label="发散探索",
        description="自由发散联想，适合头脑风暴、跨领域关联",
        system_prompt_suffix=(
            "你正在一个自由探索的分支中。请：\n"
            "- 鼓励跨领域的联想和类比\n"
            "- 不拘泥于当前话题，允许自然延伸\n"
            "- 提出多种可能性和假设\n"
            "- 用启发式的问题引导用户思考"
        ),
        context_strategy="compress",
    ),
    "summarize": ForkProfile(
        name="summarize",
        label="总结提炼",
        description="对已有对话进行结构化总结，适合阶段性回顾",
        system_prompt_suffix=(
            "你正在一个总结提炼的分支中。请：\n"
            "- 对之前讨论的内容进行结构化总结\n"
            "- 提炼关键结论、决策和待办事项\n"
            "- 用清晰的层次结构呈现\n"
            "- 标注尚存疑或需要进一步讨论的点"
        ),
        context_strategy="inherit",  # Need full context for summarization
    ),
    "challenge": ForkProfile(
        name="challenge",
        label="质疑挑战",
        description="批判性审视当前结论，适合方案评审、风险评估",
        system_prompt_suffix=(
            "你正在一个批判性审视的分支中。请：\n"
            "- 从反面论证，挑战之前的假设和结论\n"
            "- 指出潜在的风险、漏洞和边界条件\n"
            "- 提出替代方案和竞争观点\n"
            "- 保持建设性——质疑是为了改进，不是否定"
        ),
        context_strategy="compress",
    ),
}


def get_profile(name: str) -> ForkProfile | None:
    return FORK_PROFILES.get(name)


def get_all_profiles() -> dict[str, ForkProfile]:
    return FORK_PROFILES
