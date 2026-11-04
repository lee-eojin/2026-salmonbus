import { useEffect, useEffectEvent, useReducer, useState } from "react";
import { track } from "@/shared/analytics/track";
import { latestSuccessOf } from "@/shared/api/polledResource";
import { stopsAwayLabelOf } from "@/shared/utils/stopsAwayLabelOf";
import { arrivalCardHiddenPropertiesOf } from "../analytics/boardEventPolicy";
import { arrivalToneFor, type ArrivalView } from "./arrivalPolicy";
import {
  arrivalTimingFor,
  nextArrivalHideStep,
  type KnownArrival,
  type StationArrivalDetails,
} from "./stationArrivalPolicy";
import { NO_VEHICLE_NOTICE, arrivalSeatLabel } from "./verdictCopy";
import { SeatCountBadge } from "@/shared/components/SeatCountBadge";
import * as styles from "./ArrivalForecastCard.css";

interface ArrivalForecastCardProps {
  arrivals: ArrivalView[];
  stationArrivals: StationArrivalDetails | null;
}

export function ArrivalForecastCard({ arrivals, stationArrivals }: ArrivalForecastCardProps) {
  const [, tick] = useReducer((value: number) => value + 1, 0);
  const [known, setKnown] = useState<KnownArrival | null>(null);
  const latest = stationArrivals === null ? null : latestSuccessOf(stationArrivals.resource);
  const stepAtNow = () => nextArrivalHideStep(known, arrivals[0], stationArrivals, latest?.clock?.now() ?? null);
  const onSecond = useEffectEvent(() => {
    tick();
    if (document.visibilityState !== "visible") return;
    const step = stepAtNow();
    setKnown(step.known);
    if (step.hide !== null) track("arrival_card_hidden", arrivalCardHiddenPropertiesOf(step.hide));
  });
  useEffect(() => {
    if (latest === null) return;
    const timer = window.setInterval(onSecond, 1000);
    return () => window.clearInterval(timer);
  }, [latest]);

  if (arrivals.length === 0 || stepAtNow().hidden) {
    return (
      <div className={styles.card}>
        <p className={styles.notice}>{NO_VEHICLE_NOTICE}</p>
      </div>
    );
  }

  return (
    <div className={styles.card}>
      <ul className={styles.list}>
        {arrivals.map((arrival, index) => {
          const timing = arrivalTimingFor(arrival, stationArrivals);
          return (
            <li key={arrival.vehicleId ?? index} className={styles.row}>
              <span className={styles.timing}>
                {timing && <span className={styles.remainingTime}>{timing}</span>}
                <span className={timing === null ? styles.remainingTime : styles.distance}>
                  {stopsAwayLabelOf(arrival.stopsAway)}
                </span>
              </span>
              <SeatCountBadge tone={arrivalToneFor(arrival)} label={arrivalSeatLabel(arrival)} />
            </li>
          );
        })}
      </ul>
    </div>
  );
}
