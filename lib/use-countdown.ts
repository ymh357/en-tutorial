import { useEffect, useRef, useState } from "react";

// Counts down from `seconds` while `running` is true. Fires `onDone` exactly
// once when it reaches 0. Cleans up its interval on unmount / running=false.
//
// Value is stored in state and updated from the interval callback (derived from
// a start timestamp, so it's robust to background-tab interval throttling). The
// effect's cleanup resets to `seconds` so a later run (e.g. re-record) starts
// clean instead of briefly showing the previous run's last value.
export const useCountdown = (
  seconds: number,
  onDone: () => void,
  running: boolean
): { remaining: number } => {
  const [remaining, setRemaining] = useState(seconds);
  const firedRef = useRef(false);
  const onDoneRef = useRef(onDone);

  useEffect(() => {
    onDoneRef.current = onDone;
  }, [onDone]);

  useEffect(() => {
    if (!running) return;
    firedRef.current = false;
    const startedAt = Date.now();
    const id = setInterval(() => {
      const next = Math.max(
        0,
        seconds - Math.floor((Date.now() - startedAt) / 1000)
      );
      setRemaining(next);
      if (next <= 0 && !firedRef.current) {
        firedRef.current = true;
        clearInterval(id);
        onDoneRef.current();
      }
    }, 1000);
    return () => {
      clearInterval(id);
      setRemaining(seconds);
    };
  }, [running, seconds]);

  return { remaining };
};

// Counts up while `running`. Fires `onCap` once at `capSeconds`. Same approach
// as useCountdown: state updated from the interval callback (timestamp-derived,
// throttle-robust), and the cleanup resets to 0 so a re-record starts from 0
// rather than briefly showing the previous run's elapsed.
export const useStopwatch = (
  running: boolean,
  capSeconds: number,
  onCap: () => void
): { elapsed: number } => {
  const [elapsed, setElapsed] = useState(0);
  const firedRef = useRef(false);
  const onCapRef = useRef(onCap);

  useEffect(() => {
    onCapRef.current = onCap;
  }, [onCap]);

  useEffect(() => {
    if (!running) return;
    firedRef.current = false;
    const startedAt = Date.now();
    const id = setInterval(() => {
      const next = Math.floor((Date.now() - startedAt) / 1000);
      setElapsed(next);
      if (next >= capSeconds && !firedRef.current) {
        firedRef.current = true;
        onCapRef.current();
      }
    }, 1000);
    return () => {
      clearInterval(id);
      setElapsed(0);
    };
  }, [running, capSeconds]);

  return { elapsed };
};
