"use client";
import { useEffect, useRef, useState } from 'react';
import { isLunchHour, isWorkDay, type WorkCalendar } from '@/lib/office-time';

/** Quiet, locally synthesized typing. Audio starts only from an explicit click. */
export default function OfficeAmbience({ open, timeZone, calendar, activeWork }: { open: boolean; timeZone: string; calendar?: WorkCalendar; activeWork: boolean }) {
  const [enabled, setEnabled] = useState(false);
  const audio = useRef<AudioContext | null>(null);
  useEffect(() => {
    if (!enabled) return;
    const ctx = new AudioContext(); audio.current = ctx;
    void ctx.resume().catch(() => setEnabled(false));
    const timer = setInterval(() => {
      const hour = Number(new Intl.DateTimeFormat('en-GB', {timeZone, hour:'2-digit',hourCycle:'h23'}).format(new Date()));
      if (!open || hour < 8 || hour >= 17 || (!isWorkDay(timeZone, new Date(), { ...calendar, activeWork }) || isLunchHour(timeZone, new Date(), { ...calendar, activeWork })) || document.hidden || ctx.state !== 'running' || Math.random() < .45) return;
      const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * .035), ctx.sampleRate);
      const samples = buffer.getChannelData(0);
      for (let i=0;i<samples.length;i++) samples[i]=(Math.random()*2-1)*Math.exp(-i/(samples.length*.15));
      const source = ctx.createBufferSource(); source.buffer=buffer;
      const filter = ctx.createBiquadFilter(); filter.type='bandpass'; filter.frequency.value=700+Math.random()*1000;
      const gain=ctx.createGain(); gain.gain.value=.035;
      source.connect(filter); filter.connect(gain); gain.connect(ctx.destination); source.start();
      source.onended=()=>{source.disconnect();filter.disconnect();gain.disconnect();};
    }, 160);
    return ()=>{clearInterval(timer);audio.current=null;void ctx.close();};
  }, [enabled, open, timeZone, calendar, activeWork]);
  return <button className="office-top-button" aria-pressed={enabled} title="Quiet typing sounds, 08:00–17:00, paused during lunch and when this tab is hidden" onClick={()=>setEnabled(v=>!v)}>{enabled ? '♪ Sound on' : '♪ Sound off'}</button>;
}
