import { useEffect } from 'react';
import { Elevator } from '../Elevator';
import { roofElevation } from '../layout';
import { OutsideSounds } from '../OutsideSounds';
import { leavePerch } from '../perch';
import { lampsOn } from '../sky/lamps';
import { Billboards } from './Billboards';
import { DeckChairs } from './DeckChairs';
import { Garden } from './Garden';
import { Grill } from './Grill';
import { HeldSausage } from './HeldSausage';
import { RoofDeck } from './RoofDeck';
import { roofReport, runRoofOp, useRoofReport } from './roofOps';
import { RoofPeople } from './RoofPeople';
import { mountRoof } from './roofState';
import { StringLights } from './StringLights';
import { Telescope } from './Telescope';

// The roof terrace, the elevator's top stop (layout.ts has its numbers and colliders): a garden along the north
// parapet, a decking lounge with deck chairs under string lights, a barbecue, a telescope over the city and the stars,
// the water tank and a painted helipad, with the sky, sun, clouds and city all round (Game.tsx's, shared with every
// floor). Its code is fetched as the elevator heads up, and it's mounted only while you're up here, so the floors below
// never pay for it.

export default function Roof({ top }: { top: number }) {
  // E on the roof's things goes to the part that owns it; the probe gets every part's report.
  useEffect(() => mountRoof(runRoofOp, roofReport), []);
  // Leaving the roof stands you up from a deck chair or the telescope (the elevator already took your lunch).
  useEffect(() => () => void leavePerch(), []);
  useRoofReport('lights', () => Math.round(lampsOn() * 100) / 100);
  useRoofReport('elevation', () => roofElevation(top));

  return (
    <group>
      <RoofDeck top={top} />
      <Elevator floorLabel="▲ R · Roof terrace" accent="#ff8a5b" />
      <Garden />
      <StringLights />
      <DeckChairs />
      <Grill />
      <Telescope />
      <Billboards top={top} />
      <RoofPeople />
      <HeldSausage />
      <OutsideSounds kind="roof" />
    </group>
  );
}
