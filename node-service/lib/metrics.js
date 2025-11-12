// Simple in-memory metrics collector (reset on process restart)
// Not production-grade; intended for local insight and lightweight dashboards.

const samples = {
  presence: [], // { at, groups, ms, success }
  messageWrite: [], // { at, ms, success, circuit }
};

// Counters
let presenceSuccessCount = 0;
let presenceFailureCount = 0;
let messageWriteSuccessCount = 0;
let messageWriteFailureCount = 0;
let messageWriteCircuitCount = 0;

// Simple latency bucket histogram boundaries (ms)
const BUCKETS = [50, 100, 250, 500, 1000, 2000, 3000, 5000, 10000];
const presenceBuckets = Object.fromEntries(BUCKETS.map((b) => [b, 0]));
const messageBuckets = Object.fromEntries(BUCKETS.map((b) => [b, 0]));

function recordPresence(groups, ms, success) {
  samples.presence.push({ at: Date.now(), groups, ms, success: !!success });
  if (samples.presence.length > 500) samples.presence.shift();
  if (success) presenceSuccessCount++;
  else presenceFailureCount++;
  for (const b of BUCKETS)
    if (ms <= b) {
      presenceBuckets[b]++;
      break;
    }
}

function recordMessageWrite(ms, success, circuitOpen) {
  samples.messageWrite.push({
    at: Date.now(),
    ms,
    success: !!success,
    circuit: !!circuitOpen,
  });
  if (samples.messageWrite.length > 500) samples.messageWrite.shift();
  if (circuitOpen) messageWriteCircuitCount++;
  if (success) messageWriteSuccessCount++;
  else messageWriteFailureCount++;
  for (const b of BUCKETS)
    if (ms <= b) {
      messageBuckets[b]++;
      break;
    }
}

function summary(list) {
  if (!list.length) return { count: 0 };
  const msVals = list.map((x) => x.ms).filter((x) => typeof x === "number");
  msVals.sort((a, b) => a - b);
  const pct = (p) =>
    msVals[Math.min(msVals.length - 1, Math.floor(p * msVals.length))];
  return {
    count: list.length,
    avgMs: msVals.reduce((a, b) => a + b, 0) / msVals.length,
    p50: pct(0.5),
    p90: pct(0.9),
    p99: pct(0.99),
    successRate: list.filter((x) => x.success).length / list.length,
  };
}

function getMetrics() {
  return {
    presence: {
      latest: samples.presence.slice(-25),
      summary: summary(samples.presence),
      counters: {
        success: presenceSuccessCount,
        failure: presenceFailureCount,
      },
    },
    messageWrite: {
      latest: samples.messageWrite.slice(-25),
      summary: summary(samples.messageWrite),
      counters: {
        success: messageWriteSuccessCount,
        failure: messageWriteFailureCount,
        circuit: messageWriteCircuitCount,
      },
    },
  };
}

function promExpose() {
  const lines = [];
  lines.push("# HELP presence_requests_total Presence batch requests");
  lines.push("# TYPE presence_requests_total counter");
  lines.push(
    `presence_requests_total{status="success"} ${presenceSuccessCount}`
  );
  lines.push(
    `presence_requests_total{status="failure"} ${presenceFailureCount}`
  );
  lines.push("# HELP message_writes_total Message write attempts");
  lines.push("# TYPE message_writes_total counter");
  lines.push(
    `message_writes_total{status="success"} ${messageWriteSuccessCount}`
  );
  lines.push(
    `message_writes_total{status="failure"} ${messageWriteFailureCount}`
  );
  lines.push(
    `message_writes_total{status="circuit_open"} ${messageWriteCircuitCount}`
  );

  const emitBuckets = (prefix, bucketMap) => {
    lines.push(
      `# HELP ${prefix}_latency_seconds Histogram of ${prefix} latency`
    );
    lines.push(`# TYPE ${prefix}_latency_seconds histogram`);
    let cumulative = 0;
    for (const b of BUCKETS) {
      cumulative += bucketMap[b];
      lines.push(
        `${prefix}_latency_seconds_bucket{le="${b / 1000}"} ${cumulative}`
      );
    }
    // +Inf bucket
    const total = Object.values(bucketMap).reduce((a, b) => a + b, 0);
    lines.push(`${prefix}_latency_seconds_bucket{le="+Inf"} ${total}`);
    lines.push(`${prefix}_latency_seconds_count ${total}`);
  };
  emitBuckets("presence", presenceBuckets);
  emitBuckets("message", messageBuckets);
  return lines.join("\n");
}

module.exports = {
  recordPresence,
  recordMessageWrite,
  getMetrics,
  promExpose,
};
