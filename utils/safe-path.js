// Treat API-provided names as single file names on both Windows and POSIX.
// Reject unsafe names instead of rewriting them into potentially colliding names.
function safePathComponent(value, label) {
  if (typeof value !== 'string' || !value.trim() || value === '.' || value === '..' ||
      /[\\/\x00-\x1f\x7f<>:"|?*]/.test(value) || /[. ]$/.test(value) ||
      /^(con|prn|aux|nul|com[1-9\u00b9\u00b2\u00b3]|lpt[1-9\u00b9\u00b2\u00b3])(?:\.|$)/i.test(value)) {
    throw new Error(`Invalid ${label}: expected a safe file name`);
  }
  return value;
}

module.exports = { safePathComponent };
