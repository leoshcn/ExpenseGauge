import type { Schemas } from "@/api/client";
import { S } from "@/strings.zh";

const T = S.settings.schedules;

/** When a scheduled expense is due: "每月1日", "每年2月15日", "每月最后一天". */
export function ScheduleWhen({ schedule }: { schedule: Pick<Schemas["ScheduleOut"], "frequency" | "day" | "month_of_year"> }) {
  const day = T.day(schedule.day);
  return <>{schedule.frequency === "year" ? T.every.year(schedule.month_of_year ?? 1, day) : T.every.month(day)}</>;
}
