// cloudfunctions/getSharedData/index.js
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext();
  const { action, workspaceId, cardId } = event;

  switch (action) {
    case 'getSharedWorkspaces':
      return getSharedWorkspaces(OPENID);
    case 'getWorkspaceCards':
      return getWorkspaceCards(workspaceId, OPENID);
    case 'getWorkspaceChats':
      return getWorkspaceChats(workspaceId, OPENID);
    case 'getComments':
      return getComments(cardId);
    default:
      return { code: -1, msg: 'unknown action' };
  }
};

// Get all workspaces where user is a member (but not owner)
async function getSharedWorkspaces(openid) {
  const res = await db.collection('workspaces')
    .where({
      'members.openId': openid,
    })
    .limit(50)
    .get();

  // Filter: user is a member but not owner
  const shared = res.data.filter(ws =>
    ws.owner !== openid && (ws.members || []).some(m => m.openId === openid)
  );

  return { code: 0, data: shared.map(ws => ({
    localId: ws.localId,
    name: ws.name,
    icon: ws.icon,
    color: ws.color,
    owner: ws.owner,
    members: ws.members || [],
    createdAt: ws.createdAt,
  }))};
}

// Get cards in a shared workspace (with membership check)
async function getWorkspaceCards(workspaceId, openid) {
  const hasAccess = await checkMembership(workspaceId, openid);
  if (!hasAccess) return { code: -1, msg: 'no access' };

  const res = await db.collection('cards')
    .where({ workspaceLocalId: workspaceId })
    .limit(100)
    .get();

  return { code: 0, data: res.data.map(d => ({
    id: d.localId,
    workspaceId: d.workspaceLocalId,
    content: d.content,
    title: d.title,
    keywords: d.keywords || [],
    emotionTag: d.emotionTag || '',
    color: d.color,
    createdAt: d.createdAt,
    updatedAt: d.updatedAt,
    isFavorite: d.isFavorite,
    isTemp: d.isTemp,
    relatedIds: d.relatedIds || [],
    agentRecommendIds: d.agentRecommendIds || [],
    agentScores: d.agentScores || {},
    hasAiChat: d.hasAiChat,
  }))};
}

// Get AI chats in a shared workspace
async function getWorkspaceChats(workspaceId, openid) {
  const hasAccess = await checkMembership(workspaceId, openid);
  if (!hasAccess) return { code: -1, msg: 'no access' };

  // First get card IDs in this workspace
  const cardsRes = await db.collection('cards')
    .where({ workspaceLocalId: workspaceId })
    .field({ localId: true })
    .limit(100)
    .get();

  const cardIds = cardsRes.data.map(c => c.localId);
  if (cardIds.length === 0) return { code: 0, data: [] };

  const chatsRes = await db.collection('ai_chats')
    .where({ cardLocalId: _.in(cardIds) })
    .limit(100)
    .get();

  return { code: 0, data: chatsRes.data.map(d => ({
    id: d.localId,
    cardId: d.cardLocalId,
    title: d.title,
    createdAt: d.createdAt,
    messages: d.messages,
  }))};
}

// Get comments for a card
async function getComments(cardId) {
  const res = await db.collection('comments')
    .where({ cardLocalId: cardId })
    .orderBy('createdAt', 'desc')
    .limit(50)
    .get();

  return { code: 0, data: res.data.map(d => ({
    id: d.localId || d._id,
    cardId: d.cardLocalId,
    authorOpenId: d.authorOpenId,
    authorNickName: d.authorNickName,
    content: d.content,
    createdAt: d.createdAt,
  }))};
}

// Check if user is a member of the workspace
async function checkMembership(workspaceId, openid) {
  const wsRes = await db.collection('workspaces')
    .where({ localId: workspaceId })
    .field({ members: true, owner: true })
    .get();

  if (wsRes.data.length === 0) return false;

  const ws = wsRes.data[0];
  if (ws.owner === openid) return true;
  return (ws.members || []).some(m => m.openId === openid);
}
