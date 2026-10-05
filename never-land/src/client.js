'use strict';

// The Discord bot runtime was intentionally removed.  This null compatibility
// export lets the existing website gracefully use its saved database snapshots
// instead of crashing while legacy dashboard pages are being viewed.
module.exports = null;
