/**
 * What a Topic Server Action hands back to the form that called it. A refusal
 * carries the sentence to show the person rather than a status code, because
 * every refusal a Topic form can provoke (a window narrower than the cadence, a
 * standing query over the cap, a Topic that is not theirs) has one.
 */
export type TopicActionResult = { ok: true } | { ok: false; error: string };

/** The same, plus the slug a newly created Topic is addressed by. */
export type TopicCreateResult = { ok: true; slug: string } | { ok: false; error: string };
