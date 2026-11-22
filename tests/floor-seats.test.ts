import test from 'node:test';
import assert from 'node:assert/strict';
import { floorSeats, OFFICE_PLAN } from '../lib/floor-seats';

test('two through six humans occupy unique seats while agents use the remainder', () => {
  for (let people = 2; people <= 6; people++) {
    const { coworkerSeats, agentSeats } = floorSeats(people);
    assert.equal(coworkerSeats.length, people - 1);
    assert.equal(agentSeats.length, OFFICE_PLAN.desks.length - people);
    assert.equal(new Set([...coworkerSeats, ...agentSeats, 8]).size, OFFICE_PLAN.desks.length);
  }
});
