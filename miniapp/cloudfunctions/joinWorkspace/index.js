// cloudfunctions/joinWorkspace/index.js
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext();
  const { action, workspaceId, inviteCode, openId, nickName } = event;

  switch (action) {
    case 'generateInviteCode':
      return generateInviteCode(workspaceId, OPENID);
    case 'joinWorkspace':
      return joinWorkspace(inviteCode, OPENID, nickName);
    case 'removeMember':
      return removeMember(workspaceId, openId, OPENID);
    default:
      return { code: -1, msg: 'unknown action' };
  }
};

// Generate 6-char invite code for a workspace
async function generateInviteCode(workspaceId, openid) {
  // Verify caller is the workspace owner
  const wsRes = await db.collection('workspaces').where({ localId: workspaceId }).get();
  if (wsRes.data.length === 0) return { code: -1, msg: 'workspace not found' };

  const ws = wsRes.data[0];
  if (ws.owner !== openid) return { code: -2, msg: 'only owner can generate invite code' };

  // Delete old invite code for this workspace
  const oldCodes = await db.collection('invite_codes').where({ workspaceId }).get();
  for (const old of oldCodes.data) {
    await db.collection('invite_codes').doc(old._id).remove();
  }

  // Generate new code
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // avoid ambiguous chars
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }

  await db.collection('invite_codes').add({
    data: { code, workspaceId, createdAt: new Date() },
  });

  return { code: 0, data: { inviteCode: code } };
}

// Join a workspace using invite code
async function joinWorkspace(inviteCode, openid, nickName) {
  // Find invite code
  const codeRes = await db.collection('invite_codes').where({ code: inviteCode }).get();
  if (codeRes.data.length === 0) return { code: -1, msg: 'invalid invite code' };

  const { workspaceId } = codeRes.data[0];

  // Find workspace
  const wsRes = await db.collection('workspaces').where({ localId: workspaceId }).get();
  if (wsRes.data.length === 0) return { code: -2, msg: 'workspace not found' };

  const ws = wsRes.data[0];
  const members = ws.members || [];

  // Check if already a member
  if (members.some(m => m.openId === openid)) {
    return { code: 0, data: { workspaceId, msg: 'already a member' } };
  }

  // Add member
  members.push({
    openId: openid,
    nickName: nickName || '成员',
    role: 'editor',
    joinedAt: formatDate(new Date()),
  });

  await db.collection('workspaces').doc(ws._id).update({
    data: { members },
  });

  return { code: 0, data: { workspaceId, workspaceName: ws.name } };
}

// Remove a member (owner only)
async function removeMember(workspaceId, targetOpenId, callerOpenId) {
  const wsRes = await db.collection('workspaces').where({ localId: workspaceId }).get();
  if (wsRes.data.length === 0) return { code: -1, msg: 'workspace not found' };

  const ws = wsRes.data[0];
  if (ws.owner !== callerOpenId) return { code: -2, msg: 'only owner can remove members' };
  if (targetOpenId === callerOpenId) return { code: -3, msg: 'cannot remove yourself' };

  const members = (ws.members || []).filter(m => m.openId !== targetOpenId);
  await db.collection('workspaces').doc(ws._id).update({ data: { members } });

  return { code: 0, msg: 'member removed' };
}

function formatDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const h = String(date.getHours()).padStart(2, '0');
  const min = String(date.getMinutes()).padStart(2, '0');
  return `${y}-${m}-${d} ${h}:${min}`;
}
