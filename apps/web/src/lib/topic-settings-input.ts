/**
 * The schedule and per-Run ceilings a Topic's settings form edits. Every one is a
 * whole number the database also checks, so the form reads them together and
 * either sends a set the constraints accept or says what is wrong in words.
 */
export interface TopicSettings {
  cadenceDays: number;
  windowDays: number;
  maxStandingQueries: number;
  maxProbesPerRun: number;
  maxGroupsPerRun: number;
  maxVideosPerGroup: number;
  maxChannelVideosPerRun: number;
}

/** The same settings as the strings a form control hands back. */
export type TopicSettingsFields = Record<keyof TopicSettings, string>;

export type ParsedTopicSettings =
  | { ok: true; value: TopicSettings }
  | { ok: false; error: string };

interface NumericField {
  key: keyof TopicSettings;
  /** How the field is named to the person reading the error. */
  label: string;
  /** The smallest value its CHECK constraint in 019_add_topics_constraints.sql permits. */
  floor: number;
}

const SCHEDULE_FIELDS: NumericField[] = [
  { key: "cadenceDays", label: "How often to survey", floor: 1 },
  { key: "windowDays", label: "How far back each survey looks", floor: 1 },
];

const CAP_FIELDS: NumericField[] = [
  { key: "maxStandingQueries", label: "Standing searches", floor: 0 },
  { key: "maxProbesPerRun", label: "Probe searches per survey", floor: 0 },
  { key: "maxGroupsPerRun", label: "Story groups per survey", floor: 1 },
  { key: "maxVideosPerGroup", label: "Videos per group", floor: 1 },
  { key: "maxChannelVideosPerRun", label: "Channel videos per survey", floor: 1 },
];

function readNumber(fields: TopicSettingsFields, field: NumericField): number | string {
  const raw = fields[field.key].trim();
  if (raw === "") {
    return `${field.label} needs a number.`;
  }

  const value = Number(raw);
  if (!Number.isInteger(value)) {
    return `${field.label} has to be a whole number.`;
  }
  if (value < field.floor) {
    return `${field.label} has to be at least ${field.floor}.`;
  }
  return value;
}

/**
 * Reads a settings form into the numbers a Topic stores, or into the one sentence
 * that explains why it cannot. The schedule is checked before the caps, because a
 * window narrower than the cadence is the mistake a person is most likely to make
 * and the one that costs them videos.
 */
export function parseTopicSettings(fields: TopicSettingsFields): ParsedTopicSettings {
  const numbers = new Map<keyof TopicSettings, number>();

  for (const field of SCHEDULE_FIELDS) {
    const read = readNumber(fields, field);
    if (typeof read === "string") {
      return { ok: false, error: read };
    }
    numbers.set(field.key, read);
  }

  const cadenceDays = numbers.get("cadenceDays") ?? 0;
  const windowDays = numbers.get("windowDays") ?? 0;
  if (windowDays < cadenceDays) {
    return {
      ok: false,
      error: `A window of ${windowDays} days cannot cover a survey every ${cadenceDays} days. Make the window at least ${cadenceDays} days, or the days in between go unread.`,
    };
  }

  for (const field of CAP_FIELDS) {
    const read = readNumber(fields, field);
    if (typeof read === "string") {
      return { ok: false, error: read };
    }
    numbers.set(field.key, read);
  }

  return {
    ok: true,
    value: {
      cadenceDays,
      windowDays,
      maxStandingQueries: numbers.get("maxStandingQueries") ?? 0,
      maxProbesPerRun: numbers.get("maxProbesPerRun") ?? 0,
      maxGroupsPerRun: numbers.get("maxGroupsPerRun") ?? 1,
      maxVideosPerGroup: numbers.get("maxVideosPerGroup") ?? 1,
      maxChannelVideosPerRun: numbers.get("maxChannelVideosPerRun") ?? 1,
    },
  };
}

/** The seven settings of a stored Topic as the form's string fields. */
export function toTopicSettingsFields(settings: TopicSettings): TopicSettingsFields {
  return {
    cadenceDays: String(settings.cadenceDays),
    windowDays: String(settings.windowDays),
    maxStandingQueries: String(settings.maxStandingQueries),
    maxProbesPerRun: String(settings.maxProbesPerRun),
    maxGroupsPerRun: String(settings.maxGroupsPerRun),
    maxVideosPerGroup: String(settings.maxVideosPerGroup),
    maxChannelVideosPerRun: String(settings.maxChannelVideosPerRun),
  };
}
