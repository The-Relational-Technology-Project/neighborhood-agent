export interface VitalSign {
  id: string;
  /** Which constituent this speaks for (ocean, dunes, plovers, coyotes, air). */
  constituent: string;
  label: string;
  value: string;
  detail?: string;
  source: { name: string; url: string };
  fetched_at: string;
  error?: string;
}
