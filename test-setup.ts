// The bot logs a few lines per event; keep them out of the test output. A test that spies on console still
// sees its calls, and a test that checks log output uses captureLog (src/log.ts).
const silent = () => {};
console.log = silent;
console.warn = silent;
console.error = silent;
