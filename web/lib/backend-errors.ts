const ERROR_MAP: Record<string, string> = {
  "用户名或密码错误": "invalidCredentials",
  "邀请码无效": "invalidInviteCode",
  "卡片不存在": "cardNotFound",
  "对话不存在": "chatNotFound",
  "消息不存在": "messageNotFound",
  "评论不存在": "commentNotFound",
  "成员不存在": "memberNotFound",
  "API Key 不存在": "apiKeyNotFound",
  "API Key 无效或已吊销": "apiKeyInvalid",
  "无权访问此对话": "chatAccessDenied",
  "无权删除此对话": "chatDeleteDenied",
  "无法移除空间创建者": "cannotRemoveOwner",
  "无法修改创建者的角色": "cannotChangeOwnerRole",
  "只有创建者可以设置管理员角色": "onlyOwnerSetAdmin",
  "只有创建者可以修改管理员角色": "onlyOwnerChangeAdmin",
  "空间创建者无法退出自己的空间": "ownerCannotLeave",
  "只能删除自己发布的评论": "onlyDeleteOwnComment",
  "只能编辑自己创建的卡片": "onlyEditOwnCard",
  "只能删除自己创建的卡片": "onlyDeleteOwnCard",
  "需要管理员权限": "adminRequired",
  "你还没有加入任何空间": "noWorkspaceMembership",
  "你不是该空间的成员": "notWorkspaceMember",
  "该微信已绑定其他账号": "wechatAlreadyBound",
  "微信网页登录未配置（需要公众号 appid）": "wechatNotConfigured",
  "无效的 redirect_uri": "invalidRedirectUri",
  "redirect_uri 不在允许列表中": "redirectUriNotAllowed",
  "对话内容太少，无法生成摘要": "chatTooShortForSummary",
  "仅空间创建者可执行此操作": "onlyOwnerOperation",
  "通知不存在": "notificationNotFound",
  "空间不存在": "workspaceNotFound",
  "用户不存在": "userNotFound",
  "用户名已存在": "usernameTaken",
  "不能移除自己": "cannotRemoveSelf",
  "父节点不存在或不属于该工作区": "parentNodeNotFound",
  "源节点不存在": "sourceNodeNotFound",
  "目标节点不存在或不属于该工作区": "targetNodeNotFound",
  "不能引用自身": "cannotSelfReference",
  "关联不存在": "relationNotFound",
  "没有找到关联的卡片": "noCardsFound",
  "话题不存在": "topicNotFound",
  "微信绑定成功": "wechatSuccess",
  "节点不存在": "nodeNotFound",
  "local_id 已存在": "localIdExists",
};

export function translateBackendError(
  detail: string,
  t: (key: string) => string,
): string {
  const key = ERROR_MAP[detail];
  if (key) {
    return t(key);
  }
  // Handle partial matches (e.g. "local_id 已存在: xxx")
  for (const [zh, k] of Object.entries(ERROR_MAP)) {
    if (detail.startsWith(zh)) {
      return t(k);
    }
  }
  return detail;
}
