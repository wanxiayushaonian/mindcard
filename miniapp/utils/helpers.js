/**
 * Shared utility functions for miniapp.
 */

function isUuid(id) {
  return id && id.indexOf('card_') !== 0;
}

function formatTime(date) {
  var y = date.getFullYear();
  var m = String(date.getMonth() + 1).padStart(2, '0');
  var d = String(date.getDate()).padStart(2, '0');
  var h = String(date.getHours()).padStart(2, '0');
  var min = String(date.getMinutes()).padStart(2, '0');
  return y + '-' + m + '-' + d + ' ' + h + ':' + min;
}

function formatApiTime(isoStr) {
  if (!isoStr) return '';
  try {
    return formatTime(new Date(isoStr));
  } catch (_e) {
    return isoStr;
  }
}

function formatRelativeTime(ts) {
  if (!ts) return '';
  var d = new Date(ts);
  var now = new Date();
  var diff = now - d;
  if (diff < 60000) return '刚刚';
  if (diff < 3600000) return Math.floor(diff / 60000) + '分钟前';
  if (diff < 86400000) return Math.floor(diff / 3600000) + '小时前';
  if (diff < 604800000) return Math.floor(diff / 86400000) + '天前';
  var mon = d.getMonth() + 1;
  var day = d.getDate();
  return mon + '月' + day + '日';
}

module.exports = {
  isUuid: isUuid,
  formatTime: formatTime,
  formatApiTime: formatApiTime,
  formatRelativeTime: formatRelativeTime,
};
