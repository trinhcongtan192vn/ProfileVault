import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FakeClock, type BusEventMap } from '@sctech/profilevault-contract';
import { EventBus } from '@sctech/profilevault-core';
import { FakeTimers, FuryStatusPoller, HttpFuryClient } from '../src/index.js';
import { FakeFury } from './fake-fury.js';

let fake: FakeFury;
let timers: FakeTimers;
let bus: EventBus;
let events: BusEventMap['fury.status_changed'][];
let statusChanges: [string, boolean][];
let versionChanges: [string | undefined, string | undefined][];
let bound: string[];

function makePoller(client = new HttpFuryClient({ baseUrl: fake.baseUrl, supportedVersions: '>=0.2.21 <0.4.0', timers, maxRetries: 0 })) {
  return new FuryStatusPoller({
    client,
    bus,
    clock: new FakeClock(),
    timers,
    listBoundProfileIds: () => bound,
    onProfileStatusChanged: (id, open) => void statusChanges.push([id, open]),
    onVersionChanged: (from, to) => void versionChanges.push([from, to]),
  });
}

beforeEach(async () => {
  fake = new FakeFury({ version: '0.2.23' });
  await fake.start();
  fake.setProfiles([
    { id: 'p1', name: 'A' },
    { id: 'p2', name: 'B' },
  ]);
  timers = new FakeTimers();
  bus = new EventBus();
  events = [];
  statusChanges = [];
  versionChanges = [];
  bound = ['p1', 'p2'];
  bus.on('fury.status_changed', (p) => void events.push(p));
});
afterEach(async () => {
  await fake.stop();
});

describe('FuryStatusPoller (SPEC-01 §7)', () => {
  it('phát fury.status_changed khi đổi reachable/version; onVersionChanged', async () => {
    const poller = makePoller();
    await poller.tickHealth();
    await poller.tickHealth();
    expect(events).toEqual([{ reachable: true, version: '0.2.23', supported: true }]);
    fake.setVersion('0.2.24');
    await poller.tickHealth();
    expect(events).toHaveLength(2);
    expect(versionChanges).toEqual([['0.2.23', '0.2.24']]);
    await fake.stop();
    await poller.tickHealth();
    expect(events.at(-1)).toEqual({ reachable: false, supported: false });
    expect(versionChanges).toHaveLength(1);
  });

  it('profile mở/đóng → onProfileStatusChanged; không đổi → không gọi; offline → giữ trạng thái', async () => {
    const poller = makePoller();
    await poller.tickStatus();
    expect(statusChanges).toEqual([]); // lần đầu, mọi profile đóng
    fake.setOpen('p1', true, 'app');
    await poller.tickStatus();
    expect(statusChanges).toEqual([['p1', true]]);
    await poller.tickStatus();
    expect(statusChanges).toHaveLength(1);
    fake.setOpen('p1', false);
    await poller.tickStatus();
    expect(statusChanges).toEqual([
      ['p1', true],
      ['p1', false],
    ]);
    // offline: không sinh sự kiện giả
    fake.setOpen('p2', true);
    await fake.stop();
    await poller.tickHealth();
    await poller.tickStatus();
    expect(statusChanges).toHaveLength(2);
    expect(poller.lastOpen.get('p2')).toBe(false);
  });

  it('lần đầu thấy profile đang mở → báo mở (nhắc khai báo)', async () => {
    fake.setOpen('p2', true, 'app');
    const poller = makePoller();
    await poller.tickStatus();
    expect(statusChanges).toEqual([['p2', true]]);
  });

  it('start đăng ký interval 60 s và 300 s; stop hủy', () => {
    const poller = makePoller();
    poller.start();
    expect(timers.intervals.map((i) => i.ms)).toEqual([60_000, 300_000]);
    poller.stop();
    expect(timers.intervals.every((i) => !i.active)).toBe(true);
  });
});
