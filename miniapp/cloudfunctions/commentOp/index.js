// cloudfunctions/commentOp/index.js
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext();
  const { action, cardId, workspaceId, content, commentId } = event;

  switch (action) {
    case 'addComment':
      return addComment(cardId, workspaceId, content, OPENID, event.nickName);
    case 'deleteComment':
      return deleteComment(commentId, OPENID, workspaceId);
    case 'getComments':
      return getComments(cardId);
    default:
      return { code: -1, msg: 'unknown action' };
  }
};

async function addComment(cardId, workspaceId, content, openid, nickName) {
  if (!content || !content.trim()) return { code: -1, msg: 'content required' };

  // Verify membership
  const hasAccess = await checkMembership(workspaceId, openid);
  if (!hasAccess) return { code: -2, msg: 'no access' };

  const commentId = 'comment_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);

  await db.collection('comments').add({
    data: {
      localId: commentId,
      cardLocalId: cardId,
      workspaceLocalId: workspaceId,
      authorOpenId: openid,
      authorNickName: nickName || '匿名',
      content: content.trim(),
      createdAt: formatDate(new Date()),
    },
  });

  return { code: 0, data: { commentId } };
}

async function deleteComment(commentId, openid, workspaceId) {
  // Find the comment
  const commentRes = await db.collection('comments')
    .where({ localId: commentId })
    .get();

  if (commentRes.data.length === 0) return { code: -1, msg: 'comment not found' };

  const comment = commentRes.data[0];

  // Author can delete their own comment
  if (comment.authorOpenId === openid) {
    await db.collection('comments').doc(comment._id).remove();
    return { code: 0, msg: 'deleted' };
  }

  // Workspace owner can delete any comment
  if (workspaceId) {
    const wsRes = await db.collection('workspaces')
      .where({ localId: workspaceId })
      .field({ owner: true })
      .get();

    if (wsRes.data.length > 0 && wsRes.data[0].owner === openid) {
      await db.collection('comments').doc(comment._id).remove();
      return { code: 0, msg: 'deleted by owner' };
    }
  }

  return { code: -2, msg: 'no permission' };
}

async function getComments(cardId) {
  const res = await db.collection('comments')
    .where({ cardLocalId: cardId })
    .orderBy('createdAt', 'desc')
    .limit(50)
    .get();

  return {
    code: 0,
    data: res.data.map(d => ({
      id: d.localId || d._id,
      cardId: d.cardLocalId,
      authorOpenId: d.authorOpenId,
      authorNickName: d.authorNickName,
      content: d.content,
      createdAt: d.createdAt,
    })),
  };
}

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

function formatDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const h = String(date.getHours()).padStart(2, '0');
  const min = String(date.getMinutes()).padStart(2, '0');
  return `${y}-${m}-${d} ${h}:${min}`;
}
