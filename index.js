const EventLoopStats = require("./node-event-loop-stats").default;
const { nextNice } = require("./node-nice");

const loopMonitor = new EventLoopStats("sample");

const NS_PER_MS = 1e6;
const NS_PER_SEC = NS_PER_MS * 1e3;

setTimeout(() => loopMonitor.start(), 1000);

/***
 * This function emulates some kind of IO.
 */
function emulateIoMillis(timeoutMs) {
  return new Promise(resolve => {
    // We want to only set the timeout when the next io loop happens
    // i.e. the request would have been sent out
    setImmediate(() => {
      setTimeout(resolve, timeoutMs);
    });
  });
}

let actualWorkNs = 0;
function computeForMillis(millis) {
  const nanos = millis * NS_PER_MS;
  const start = process.hrtime();
  let takenNs = 0;
  while (takenNs < nanos) {
    const taken = process.hrtime(start);
    takenNs = taken[0] * NS_PER_SEC + taken[1];
  }
  actualWorkNs += takenNs;
}

const strategies = {
  normal: async (io, work) => {
    while (true) {
      await io();
      work();
    }
  },

  awaitNextNice: async (io, work) => {
    while (true) {
      await io();
      await new Promise(resolve => {
        nextNice(() => {
          work();

          resolve();
        });
      });
    }
  }
};

const strategy = strategies[process.argv[2]];

if (!strategy) {
  console.error("Usage: ./time <" + Object.keys(strategies).join(" | ") + ">");
  process.exit(1);
}

const workStart = process.hrtime();
const io = () => emulateIoMillis(Math.random() * 100);
const work = () => computeForMillis(Math.random() * 0.5);
for (let i = 0; i < 1000; i++) {
  strategy(io, work);
}

setInterval(() => {
  const totalTime = process.hrtime(workStart);
  const totalTimeNs = totalTime[0] * NS_PER_SEC + totalTime[1];

  console.log(actualWorkNs / totalTimeNs);
}, 1000);
