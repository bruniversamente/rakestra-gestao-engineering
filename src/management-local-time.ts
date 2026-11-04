export function localDateTimeInTimeZoneToIso(
  value: string,
  timeZone: string,
): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) throw new Error("MANAGEMENT_LOCAL_TIME_INVALID");
  const target = {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    hour: Number(match[4]),
    minute: Number(match[5]),
    second: 0,
  };
  if (
    target.month < 1 ||
    target.month > 12 ||
    target.day < 1 ||
    target.day > 31 ||
    target.hour > 23 ||
    target.minute > 59
  )
    throw new Error("MANAGEMENT_LOCAL_TIME_INVALID");
  try {
    const formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      calendar: "iso8601",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
    const read = (instant: number) => {
      const parts = Object.fromEntries(
        formatter
          .formatToParts(new Date(instant))
          .filter((part) => part.type !== "literal")
          .map((part) => [part.type, Number(part.value)]),
      );
      return {
        year: parts.year,
        month: parts.month,
        day: parts.day,
        hour: parts.hour,
        minute: parts.minute,
        second: parts.second,
      };
    };
    const targetEpoch = Date.UTC(
      target.year,
      target.month - 1,
      target.day,
      target.hour,
      target.minute,
      0,
    );
    let candidate = targetEpoch;
    for (let index = 0; index < 6; index += 1) {
      const rendered = read(candidate);
      const renderedEpoch = Date.UTC(
        rendered.year,
        rendered.month - 1,
        rendered.day,
        rendered.hour,
        rendered.minute,
        rendered.second,
      );
      const delta = targetEpoch - renderedEpoch;
      if (delta === 0) break;
      candidate += delta;
    }
    const rendered = read(candidate);
    if (
      Object.keys(target).some(
        (key) =>
          rendered[key as keyof typeof target] !==
          target[key as keyof typeof target],
      )
    ) {
      throw new Error("MANAGEMENT_LOCAL_TIME_INVALID");
    }
    return new Date(candidate).toISOString();
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === "MANAGEMENT_LOCAL_TIME_INVALID"
    )
      throw error;
    throw new Error("MANAGEMENT_LOCAL_TIME_INVALID");
  }
}
