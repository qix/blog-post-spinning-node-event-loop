const { EventLoopMonitor } = require("node-event-loop-stats");
const { nextNice, nicePromise } = require("node-nice");
const docopt = require("docopt").docopt;

function buildDoc(examples) {
  const usage = examples
    .map(name => `  ./example [options] ${name}`)
    .join("\n");
  return `
Usage:
${usage}

Options:
  --io=<io>        Time spent in IO [default: 0]
  --work=<work>    Time spent doing work [default: 1]
  --loops=<loops>  Number of loops to perform [default: 1]
  --parallel=<n>   Number of examples to perform in parallel [default: 1]
  --random-io      Randomly pick I/O time between 0*<io> and 2*<io> 
`;
}
const NS_PER_MS = 1e6;
const NS_PER_SEC = NS_PER_MS * 1e3;

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

const examples = {
  async simpleWorkLoop(io, work, workCount) {
    for (let i = 0; i < workCount; i++) {
      work();
    }
  },

  async simpleIoWorkLoop(io, work, workCount) {
    for (let i = 0; i < workCount; i++) {
      await io();
      work();
    }
  },

  async setImmediateLoop(io, work, workCount) {
    for (let i = 0; i < workCount; i++) {
      await io();
      await new Promise(resolve => {
        setImmediate(() => {
          work();
          resolve();
        });
      });
    }
  },

  async niceIoWorkLoop(io, work, workCount) {
    for (let i = 0; i < workCount; i++) {
      await io();
      await nicePromise(() => {
        work();
      });
    }
  }
};

const argv = docopt(buildDoc(Object.keys(examples)));
const exampleName = Object.keys(examples).filter(name => argv[name]);
const ioMs = parseFloat(argv["--io"]);
const workMs = parseFloat(argv["--work"]);
const loopCount = parseInt(argv["--loops"], 10);
const parallelCount = parseInt(argv["--parallel"], 10);

const example = examples[exampleName];

let io;
if (argv["--random-io"]) {
  io = () => emulateIoMillis(Math.random() * ioMs * 2);
} else {
  io = () => emulateIoMillis(ioMs);
}
const work = () => computeForMillis(workMs);

(async function() {
  const loopMonitor = new EventLoopMonitor({
    timeoutMs: 0
  });

  const logStats = () => {
    const totalTime = process.hrtime(workStart);
    const totalTimeNs = totalTime[0] * NS_PER_SEC + totalTime[1];
    const usefulPercent = 100 * (actualWorkNs / totalTimeNs);
    console.log(
      `useful=${usefulPercent.toFixed(1)}% ` + `${loopMonitor.getStatsString()}`
    );
  };

  // Work is run in a hot loop, make sure whatever JIT needs to be done is done
  // on it so that we get better timing
  emulateIoMillis(1000);

  // Startup can often introduce freezes. Give node some time to ensure that
  // work is done and we get more accurate results.
  await new Promise(setImmediate);
  await new Promise(resolve => {
    setTimeout(resolve, 1000);
  });
  await new Promise(setImmediate);

  // Start statitistics/monitoring
  const workStart = process.hrtime();
  const statInterval = setInterval(logStats, 1000);
  loopMonitor.start();
  actualWorkNs = 0;

  const promises = new Array(parallelCount);
  for (let i = 0; i < parallelCount; i++) {
    promises[i] = example(io, work, loopCount);
  }

  await Promise.all(promises);
  await new Promise(setImmediate);

  clearInterval(statInterval);
  logStats();
  loopMonitor.stop();
})();
