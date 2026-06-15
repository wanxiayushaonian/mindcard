/**
 * Shared utility functions for miniapp.
 */

function isUuid(id) {
  return !!id && id !== 'undefined' && id.indexOf('card_') !== 0;
}

function formatTime(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const h = String(date.getHours()).padStart(2, '0');
  const min = String(date.getMinutes()).padStart(2, '0');
  return `${y}-${m}-${d} ${h}:${min}`;
}

function formatApiTime(isoStr) {
  if (!isoStr) return '';
  try {
    return formatTime(new Date(isoStr));
  } catch (_e) {
    return isoStr;
  }
}

module.exports = { isUuid, formatTime, formatApiTime };
