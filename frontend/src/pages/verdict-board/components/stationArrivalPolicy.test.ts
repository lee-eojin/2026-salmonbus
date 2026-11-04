import { describe, expect, it } from "@jest/globals";
import type { ArrivalVehicle, StationArrivalsResponse } from "@/shared/api/stationArrivals.types";
import { arrivalTimingFor, nextArrivalHideStep, type StationArrivalDetails } from "./stationArrivalPolicy";
import type { ArrivalView } from "./arrivalPolicy";

const now = Date.parse("2026-10-16T03:00:00Z");
const arrival: ArrivalView = {
  kind: "available",
  vehicleId: "bus-1",
  stopsAway: 3,
  level: "high",
  seatEstimate: { kind: "count", seats: 15 },
};

function detailsWith(seconds = 120) {
  const vehicle: ArrivalVehicle = {
    vehicleId: "bus-1",
    ordinal: 1,
    remainingStops: 3,
    eta: {
      status: "AVAILABLE",
      reason: null,
      resolution: "SECONDS",
      estimateBaseAt: new Date(now).toISOString(),
      baseKind: "RECEIVED_AT_APPROXIMATION",
      expectedArrivalAt: new Date(now + seconds * 1000).toISOString(),
      remainingSeconds: seconds,
    },
    currentSeat: { kind: "EXACT", remaining: 28, reason: null },
    congestionCode: null,
    vehicleTypeCode: null,
    taglessSupported: null,
  };
  return {
    selection: {
      stationId: "206000637",
      routeId: "204000057",
      referenceVersionId: "7",
      stopSequence: 22,
      direction: "UP",
    },
    resource: {
      status: "success",
      lifetime: { noStore: false, maxAgeSeconds: 5, ageSeconds: 0 },
      latestSuccess: {
        receivedAt: now,
        clock: { servedAt: now, now: () => now },
        body: {
          stationId: "206000637",
          generatedAt: new Date(now).toISOString(),
          status: "READY",
          reason: null,
          snapshot: {
            snapshotId: "snapshot",
            receivedAt: new Date(now).toISOString(),
            sourceObservedAt: null,
            sourceQueryTime: null,
            refreshAfterAt: new Date(now + 40000).toISOString(),
            staleAt: new Date(now + 60000).toISOString(),
          },
          refresh: { status: "IDLE", reason: null, suggestedRefreshAt: new Date(now + 40000).toISOString() },
          routes: [
            {
              routeId: "204000057",
              name: "3330",
              status: "READY",
              reason: null,
              targetVisit: {
                referenceVersionId: "7",
                stopSequence: 22,
                sourceStopOrder: 22,
                matchStatus: "MATCHED",
                direction: "UP",
              },
              arrivals: [vehicle],
            },
          ],
        } as StationArrivalsResponse,
      },
    },
  } satisfies StationArrivalDetails;
}

describe("arrivalTimingFor", () => {
  it("같은 차량의 시간만 연결하고 watch 거리와 좌석 예보는 유지한다", () => {
    const details = detailsWith();
    const route = details.resource.latestSuccess.body.routes[0]!;
    route.arrivals.unshift({ ...route.arrivals[0]!, vehicleId: "another-bus", ordinal: 2, remainingStops: 9 });
    expect(arrivalTimingFor(arrival, details)).toBe("2분 남음");
    expect(arrival.seatEstimate).toEqual({ kind: "count", seats: 15 });
  });

  it.each([0, -1, 59, 60, 61, 120, 121])("예상 시각까지 %i초 남은 경계를 처리한다", (seconds) => {
    const expected = seconds <= 0 ? null : seconds <= 60 ? "1분 이내" : `${Math.ceil(seconds / 60)}분 남음`;
    expect(arrivalTimingFor(arrival, detailsWith(seconds))).toEqual(expected);
  });

  it.each(["stationId", "routeId", "referenceVersionId", "stopSequence", "direction"] as const)(
    "선택한 %s가 다르면 연결하지 않는다",
    (field) => {
      const details = detailsWith();
      const selection = {
        ...details.selection,
        [field]: field === "stopSequence" ? 23 : "different",
      } as StationArrivalDetails["selection"];
      expect(arrivalTimingFor(arrival, { ...details, selection })).toBeNull();
    },
  );

  it("차량 ID가 없거나 다른 차량이거나 중복되면 순서나 거리로 추측하지 않는다", () => {
    const details = detailsWith();
    expect(arrivalTimingFor({ ...arrival, vehicleId: null }, details)).toBeNull();
    expect(arrivalTimingFor({ ...arrival, vehicleId: "missing" }, details)).toBeNull();
    const vehicles = details.resource.latestSuccess.body.routes[0]!.arrivals;
    vehicles.push({ ...vehicles[0]!, ordinal: 2 });
    expect(arrivalTimingFor(arrival, details)).toBeNull();
  });

  it.each([2, 4, 0, null])(
    "ETA 거리 %s가 watch 거리 3과 달라도 같은 차량의 유효한 시간은 표시한다",
    (remainingStops) => {
      const details = detailsWith();
      details.resource.latestSuccess.body.routes[0]!.arrivals[0]!.remainingStops = remainingStops;
      expect(arrivalTimingFor(arrival, details)).toBe("2분 남음");
      expect(arrival.stopsAway).toBe(3);
    },
  );

  it("정류장에 도착한 차량은 도착정보와 상관없이 시간 칸을 비운다", () => {
    const arrived = { ...arrival, stopsAway: 0 };
    expect(arrivalTimingFor(arrived, null)).toBeNull();
    expect(arrivalTimingFor(arrived, detailsWith())).toBeNull();
  });

  it("서버 시각의 스냅샷 만료 즉시 시간을 사용하지 않는다", () => {
    const details = detailsWith();
    details.resource.latestSuccess.clock.now = () => now + 60000;
    expect(arrivalTimingFor(arrival, details)).toBeNull();
    details.resource.latestSuccess.clock.now = () => now;
    details.resource.latestSuccess.body.reason = "STALE";
    expect(arrivalTimingFor(arrival, details)).toBeNull();
  });

  it("최초 조회와 수집 중에는 시간 문구를 표시하지 않는다", () => {
    const details = detailsWith();
    expect(arrivalTimingFor(arrival, { ...details, resource: { status: "idle" } })).toBeNull();
    expect(arrivalTimingFor(arrival, { ...details, resource: { status: "pending" } })).toBeNull();
    const collecting: StationArrivalDetails = {
      ...details,
      resource: {
        ...details.resource,
        latestSuccess: {
          ...details.resource.latestSuccess,
          body: {
            ...details.resource.latestSuccess.body,
            status: "UNAVAILABLE",
            reason: "NOT_COLLECTED",
            snapshot: null,
            refresh: {
              status: "RUNNING",
              reason: "COLLECTING",
              suggestedRefreshAt: new Date(now + 2000).toISOString(),
            },
            routes: [],
          },
        },
      },
    };
    expect(arrivalTimingFor(arrival, collecting)).toBeNull();
  });

  it("빈 ETA나 제공 불가 응답은 시간만 숨기고 watch 거리와 좌석을 변경하지 않는다", () => {
    const details = detailsWith();
    const body = details.resource.latestSuccess.body;
    for (const status of ["NO_PREDICTION", "UNAVAILABLE"] as const) {
      body.status = status;
      expect(arrivalTimingFor(arrival, details)).toBeNull();
      body.status = "READY";
      body.routes[0]!.status = status;
      expect(arrivalTimingFor(arrival, details)).toBeNull();
    }
    body.routes = [];
    expect(arrivalTimingFor(arrival, details)).toBeNull();
    expect(arrival).toMatchObject({ stopsAway: 3, seatEstimate: { kind: "count", seats: 15 } });
  });

  it("시계나 snapshot이 없거나 방문이 검증되지 않으면 시간을 연결하지 않는다", () => {
    const details = detailsWith();
    const latest = details.resource.latestSuccess;
    expect(
      arrivalTimingFor(arrival, {
        ...details,
        resource: { ...details.resource, latestSuccess: { ...latest, clock: null } },
      }),
    ).toBeNull();
    latest.body.routes[0]!.targetVisit.matchStatus = "UNVERIFIED";
    expect(arrivalTimingFor(arrival, details)).toBeNull();
    latest.body.routes[0]!.targetVisit.matchStatus = "MATCHED";
    latest.body.snapshot = null;
    expect(arrivalTimingFor(arrival, details)).toBeNull();
  });

  it("제공 불가이거나 잘못된 ETA 시각은 도착으로 추정하지 않는다", () => {
    for (const eta of [
      { status: "UNAVAILABLE" as const },
      { remainingSeconds: null },
      { expectedArrivalAt: "invalid" },
    ]) {
      const details = detailsWith();
      Object.assign(details.resource.latestSuccess.body.routes[0]!.arrivals[0]!.eta, eta);
      expect(arrivalTimingFor(arrival, details)).toBeNull();
    }
  });

  it("재조회 실패도 아직 유효한 ETA는 유지한다", () => {
    const details = detailsWith();
    expect(
      arrivalTimingFor(arrival, {
        ...details,
        resource: {
          status: "refetchError",
          failure: { kind: "network", cause: null },
          latestSuccess: details.resource.latestSuccess,
        },
      }),
    ).toBe("2분 남음");
    expect(
      arrivalTimingFor(arrival, { ...details, resource: { status: "loadingError", failure: { kind: "timeout" } } }),
    ).toBeNull();
  });
});

describe("nextArrivalHideStep", () => {
  const seconds = (value: number) => now + value * 1000;

  function polledAt(servedAt: number, etaSeconds: number) {
    const details = detailsWith(etaSeconds);
    details.resource.latestSuccess.clock.servedAt = servedAt;
    return details;
  }

  function hiddenFor(etaSeconds = 90) {
    const details = detailsWith(etaSeconds);
    const { known } = nextArrivalHideStep(null, arrival, details, seconds(etaSeconds - 60) + 1);
    expect(known?.hidden).toBe(true);
    return known;
  }

  it("도착까지 정확히 60초 남으면 유지하고 1ms 더 지나면 walk_time으로 숨긴다", () => {
    const details = detailsWith(90);
    expect(nextArrivalHideStep(null, arrival, details, seconds(30))).toMatchObject({ hidden: false, hide: null });
    expect(nextArrivalHideStep(null, arrival, details, seconds(30) + 1)).toMatchObject({
      hidden: true,
      hide: { reason: "walk_time" },
    });
  });

  it("새 폴링이 없어도 같은 응답에서 시간이 지나면 숨긴다", () => {
    const details = detailsWith(90);
    const first = nextArrivalHideStep(null, arrival, details, now);
    expect(first.hidden).toBe(false);
    const second = nextArrivalHideStep(first.known, arrival, details, seconds(31));
    expect(second.hidden).toBe(true);
    expect(second.hide?.reason).toBe("walk_time");
  });

  it("마지막 폴링 뒤 정확히 60초면 유지하고 1ms 더 지나면 stale로 숨긴다", () => {
    const details = detailsWith(600);
    expect(nextArrivalHideStep(null, arrival, details, seconds(60))).toMatchObject({ hidden: false, hide: null });
    expect(nextArrivalHideStep(null, arrival, details, seconds(60) + 1)).toMatchObject({
      hidden: true,
      hide: { reason: "stale" },
    });
  });

  it("두 조건이 모두 맞으면 stale로 남긴다", () => {
    expect(nextArrivalHideStep(null, arrival, detailsWith(90), seconds(61)).hide?.reason).toBe("stale");
  });

  it("숨겨진 동안 이어지는 틱과 여전히 숨길 폴링에서는 이벤트를 다시 보내지 않는다", () => {
    const details = detailsWith(90);
    const first = nextArrivalHideStep(null, arrival, details, seconds(31));
    expect(first.hide).not.toBeNull();
    const nextTick = nextArrivalHideStep(first.known, arrival, details, seconds(32));
    expect(nextTick).toMatchObject({ hidden: true, hide: null });
    const nextPoll = nextArrivalHideStep(nextTick.known, arrival, polledAt(seconds(40), 90), seconds(41));
    expect(nextPoll).toMatchObject({ hidden: true, hide: null });
  });

  it("더 늦은 ETA가 오면 다시 보여 주고 또 숨길 때 이벤트를 다시 보낸다", () => {
    const shown = nextArrivalHideStep(hiddenFor(), arrival, polledAt(seconds(40), 300), seconds(40));
    expect(shown).toMatchObject({ hidden: false, hide: null });
    const hiddenAgain = nextArrivalHideStep(shown.known, arrival, polledAt(seconds(235), 300), seconds(241));
    expect(hiddenAgain.hidden).toBe(true);
    expect(hiddenAgain.hide?.reason).toBe("walk_time");
  });

  it.each([
    [
      "ETA가 UNAVAILABLE",
      (details: ReturnType<typeof detailsWith>) => {
        const { eta } = details.resource.latestSuccess.body.routes[0]!.arrivals[0]!;
        eta.status = "UNAVAILABLE";
        eta.remainingSeconds = null;
      },
    ],
    [
      "노선과 응답이 UNAVAILABLE",
      (details: ReturnType<typeof detailsWith>) => {
        const { body } = details.resource.latestSuccess;
        body.status = "UNAVAILABLE";
        body.routes[0]!.status = "UNAVAILABLE";
      },
    ],
    [
      "routes가 빈 배열",
      (details: ReturnType<typeof detailsWith>) => {
        details.resource.latestSuccess.body.routes = [];
      },
    ],
    [
      "ETA 시각이 잘못됨",
      (details: ReturnType<typeof detailsWith>) => {
        details.resource.latestSuccess.body.routes[0]!.arrivals[0]!.eta.expectedArrivalAt = "invalid";
      },
    ],
  ])("지나간 버스는 다음 폴링에서 %s이어도 숨긴 채로 둔다", (_, degrade) => {
    const details = polledAt(seconds(40), 90);
    degrade(details);
    expect(nextArrivalHideStep(hiddenFor(), arrival, details, seconds(41))).toMatchObject({ hidden: true, hide: null });
  });

  it("snapshot이 만료된 뒤에도 숨긴다", () => {
    const details = detailsWith(90);
    details.resource.latestSuccess.body.snapshot!.staleAt = new Date(seconds(1)).toISOString();
    expect(nextArrivalHideStep(null, arrival, details, seconds(31)).hide?.reason).toBe("walk_time");
  });

  it("차량이 바뀌면 이전 차량의 기억을 쓰지 않는다", () => {
    const next = { ...arrival, vehicleId: "bus-2" };
    const unknownEta = polledAt(seconds(40), 90);
    expect(nextArrivalHideStep(hiddenFor(), next, unknownEta, seconds(41))).toEqual({
      known: null,
      hidden: false,
      hide: null,
    });
    const nextEta = polledAt(seconds(40), 300);
    nextEta.resource.latestSuccess.body.routes[0]!.arrivals[0]!.vehicleId = "bus-2";
    expect(nextArrivalHideStep(hiddenFor(), next, nextEta, seconds(41))).toEqual({
      known: { vehicleId: "bus-2", expectedArrivalAt: seconds(300), hidden: false },
      hidden: false,
      hide: null,
    });
  });

  it("접었다가 다시 펼쳐 조회를 기다리는 동안 숨김을 유지하고 이벤트를 보내지 않는다", () => {
    const collapsed = nextArrivalHideStep(hiddenFor(), arrival, null, null);
    expect(collapsed).toMatchObject({ hidden: true, hide: null });
    const pending = { ...detailsWith(90), resource: { status: "pending" as const } };
    expect(nextArrivalHideStep(collapsed.known, arrival, pending, null)).toMatchObject({ hidden: true, hide: null });
    expect(nextArrivalHideStep(collapsed.known, arrival, pending, seconds(100))).toMatchObject({
      hidden: true,
      hide: null,
    });
  });

  it("차량 ID나 ETA가 전혀 없으면 폴링이 끊겨도 숨기지 않고 이벤트도 보내지 않는다", () => {
    const silent = seconds(600);
    const none = { known: null, hidden: false, hide: null };
    const noRoutes = detailsWith(90);
    noRoutes.resource.latestSuccess.body.routes = [];
    const invalidEta = detailsWith(90);
    invalidEta.resource.latestSuccess.body.routes[0]!.arrivals[0]!.eta.expectedArrivalAt = "invalid";

    expect(nextArrivalHideStep(null, { ...arrival, vehicleId: null }, detailsWith(90), silent)).toEqual(none);
    expect(nextArrivalHideStep(null, { ...arrival, vehicleId: "missing" }, detailsWith(90), silent)).toEqual(none);
    expect(nextArrivalHideStep(null, undefined, detailsWith(90), silent)).toEqual(none);
    expect(nextArrivalHideStep(null, arrival, noRoutes, silent)).toEqual(none);
    expect(nextArrivalHideStep(null, arrival, invalidEta, silent)).toEqual(none);
  });

  it("이벤트의 마지막 폴링 시각은 브라우저 수신 시각이 아니라 서버 시계의 servedAt이다", () => {
    const details = polledAt(seconds(10), 90);
    details.resource.latestSuccess.receivedAt = seconds(25);
    expect(nextArrivalHideStep(null, arrival, details, seconds(31)).hide).toEqual({
      selection: details.selection,
      vehicleId: "bus-1",
      reason: "walk_time",
      hiddenAt: seconds(31),
      expectedArrivalAt: seconds(90),
      lastPolledAt: seconds(10),
    });
  });
});
