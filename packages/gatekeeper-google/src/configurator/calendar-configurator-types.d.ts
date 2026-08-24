export type ConfiguratorOption = {
  value: string;
  title: string;
  subtitle?: string;
  meta?: string;
}

export type { CalendarAvailabilityMode } from "../calendar-types";

export type CalendarConfiguratorValues = {
  calendarId?: string | null;
  availabilityMode?: CalendarAvailabilityMode | null;
}

export interface CalendarConfiguratorRpc {
  listCalendars(query: string): Promise<ConfiguratorOption[]>;
  /**
   * The stable id of the account's primary calendar (its email address), or null if it can't be
   * read. A binding cannot store the account-relative "primary" alias, so a request that arrives
   * proposing it is resolved to this before the form opens.
   */
  primaryCalendarId(): Promise<string | null>;
}
