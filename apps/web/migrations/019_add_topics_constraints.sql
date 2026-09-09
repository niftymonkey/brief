-- Topics: data integrity constraints for cadence, window, caps, and channel provenance.

ALTER TABLE topics
  ADD CONSTRAINT topics_cadence_days_check CHECK (cadence_days >= 1);

ALTER TABLE topics
  ADD CONSTRAINT topics_window_days_check CHECK (window_days >= cadence_days);

ALTER TABLE topics
  ADD CONSTRAINT topics_max_standing_queries_check CHECK (max_standing_queries >= 0);

ALTER TABLE topics
  ADD CONSTRAINT topics_max_probes_per_run_check CHECK (max_probes_per_run >= 0);

ALTER TABLE topics
  ADD CONSTRAINT topics_max_groups_per_run_check CHECK (max_groups_per_run >= 1);

ALTER TABLE topics
  ADD CONSTRAINT topics_max_videos_per_group_check CHECK (max_videos_per_group >= 1);

ALTER TABLE topics
  ADD CONSTRAINT topics_max_channel_videos_per_run_check CHECK (max_channel_videos_per_run >= 1);

ALTER TABLE topic_channels
  ADD CONSTRAINT topic_channels_added_via_check
  CHECK (added_via IN ('takeout', 'manual', 'suggested'));
