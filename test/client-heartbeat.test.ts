import assert from 'node:assert/strict';
import test from 'node:test';
import { BridgeHeartbeat } from '../src/client/heartbeat.ts';

test('stays disconnected until a service-worker-backed ready signal is observed', () => {
  const heartbeat = new BridgeHeartbeat(3_000);

  assert.equal(heartbeat.isAlive(0), false);
  heartbeat.markReady(1_000);
  assert.equal(heartbeat.isAlive(1_000), true);
});

test('expires readiness when service-worker-backed ready signals stop arriving', () => {
  const heartbeat = new BridgeHeartbeat(3_000);
  heartbeat.markReady(1_000);

  assert.equal(heartbeat.isAlive(3_999), true);
  assert.equal(heartbeat.isAlive(4_000), false);
  heartbeat.markReady(4_100);
  assert.equal(heartbeat.isAlive(4_100), true);
});
